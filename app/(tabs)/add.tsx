// Manual expense entry (docs/plan/EXECUTE.md §5.3): Details -> Items -> create the
// transaction via CRDT, then hand off to the split editor for step 3.
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useDatabase } from 'src/ui/DatabaseContext';
import { useTheme } from 'src/ui/theme';
import { parseToMinorUnits } from 'src/core/money';
import { newId } from 'src/core/id';
import { fnv1a } from 'src/core/hash';
import { writeToGroup } from 'src/crdt/store';
import { createTransaction, setLine } from 'src/crdt/write';
import { extractPdfText } from 'src/platform/pdf';
import { parseStatementCsv, parseStatementText } from 'src/parse/statement';
import { createStatementArtifact, findArtifactByFileHash } from 'src/db/queries/statements';
import { GroupOption, PaymentModeOption, StoreOption, getGroupOptions, getPaymentModeOptions, getStoreOptions } from 'src/db/queries/add';
import { GroupMember, getGroupMembers } from 'src/db/queries/groups';

const STEPS = ['1. Details', '2. Items'] as const;

interface DraftLine {
  key: string;
  productName: string;
  amountText: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AddExpense() {
  const theme = useTheme();
  const router = useRouter();
  const { db, selfUserId, selfDeviceId } = useDatabase();

  const [step, setStep] = useState<0 | 1>(0);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentModeOption[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);

  const [groupId, setGroupId] = useState<string | null>(null);
  const [payerUserId, setPayerUserId] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [amountText, setAmountText] = useState('');
  const [currency, setCurrency] = useState('');
  const [description, setDescription] = useState('');
  const [storeId, setStoreId] = useState<string | null>(null);
  const [paymentModeId, setPaymentModeId] = useState<string | null>(null);

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [groupList, storeList, paymentModeList] = await Promise.all([
        getGroupOptions(db, selfUserId),
        getStoreOptions(db),
        getPaymentModeOptions(db),
      ]);
      if (!cancelled) {
        setGroups(groupList);
        setStores(storeList);
        setPaymentModes(paymentModeList);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, selfUserId]);

  useEffect(() => {
    if (!groupId) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const memberList = await getGroupMembers(db, groupId);
      if (!cancelled) setMembers(memberList);
    })();
    return () => {
      cancelled = true;
    };
  }, [db, groupId]);

  const selectGroup = (group: GroupOption) => {
    setGroupId(group.groupId);
    setCurrency(group.defaultCurrency);
    setPayerUserId(selfUserId);
  };

  const addLine = () => {
    setLines((prev) => [...prev, { key: newId('draft'), productName: '', amountText: '' }]);
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const canContinue = groupId !== null && payerUserId !== null && date.length > 0 && amountText.length > 0 && currency.length === 3;

  const handleImportStatement = async () => {
    setImportError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'text/csv', 'text/comma-separated-values'],
    });
    if (result.canceled) return;

    setImporting(true);
    try {
      const asset = result.assets[0];
      const isCsv = asset.mimeType === 'text/csv' || asset.name.toLowerCase().endsWith('.csv');
      const rawText = isCsv ? await new File(asset.uri).text() : await extractPdfText(asset.uri);
      const fileHash = fnv1a(rawText);

      const existing = await findArtifactByFileHash(db, fileHash);
      if (existing) {
        router.push({ pathname: '/review/[artifactId]', params: { artifactId: existing.artifactId } });
        return;
      }

      const parsed = isCsv ? parseStatementCsv(rawText) : parseStatementText(rawText);
      const artifactId = await createStatementArtifact(db, {
        fileUri: asset.uri,
        fileHash,
        rawText,
        parsedJson: JSON.stringify(parsed),
      });
      router.push({ pathname: '/review/[artifactId]', params: { artifactId } });
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const handleCreate = async () => {
    setError(null);
    if (!groupId || !payerUserId) return;
    const group = groups.find((g) => g.groupId === groupId);
    if (!group) return;

    let totalAmountMinorUnits: number;
    try {
      totalAmountMinorUnits = parseToMinorUnits(amountText, currency);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (totalAmountMinorUnits <= 0) {
      setError('Amount must be greater than zero');
      return;
    }

    const draftLines = lines.filter((l) => l.productName.trim().length > 0 && l.amountText.trim().length > 0);
    let lineAmounts: number[];
    try {
      lineAmounts = draftLines.map((l) => parseToMinorUnits(l.amountText, currency));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const lineSum = lineAmounts.reduce((a, b) => a + b, 0);
    if (lineSum > totalAmountMinorUnits) {
      setError('Line items add up to more than the total amount');
      return;
    }

    setSaving(true);
    try {
      const trxnId = newId('trx');
      const now = new Date().toISOString();
      await writeToGroup(db, group.crdtDocId, selfDeviceId, (doc) => {
        createTransaction(doc, selfDeviceId, {
          trxnId,
          groupId,
          payerUserId,
          ownerDeviceId: selfDeviceId,
          storeId,
          paymentModeId,
          trxnDate: date,
          description: description.trim().length > 0 ? description.trim() : null,
          totalAmount: totalAmountMinorUnits,
          currency,
          detailLevel: draftLines.length > 0 ? 'ITEMIZED' : 'HEADER_ONLY',
          sourceType: 'MANUAL',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
        draftLines.forEach((l, i) => {
          setLine(doc, selfDeviceId, {
            lineId: newId('lin'),
            trxnId,
            lineNo: i + 1,
            productName: l.productName.trim(),
            quantityNum: 1,
            quantityDen: 1,
            unitPrice: null,
            lineAmount: lineAmounts[i],
            deletedAt: null,
          });
        });
      });

      setGroupId(null);
      setPayerUserId(null);
      setDate(todayIso());
      setAmountText('');
      setCurrency('');
      setDescription('');
      setStoreId(null);
      setPaymentModeId(null);
      setLines([]);
      setStep(0);

      router.push({ pathname: '/split/[trxnId]', params: { trxnId } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.bgPrimary }]} contentContainerStyle={styles.content}>
      <View style={styles.stepRow}>
        {STEPS.map((label, i) => (
          <Pressable key={label} onPress={() => setStep(i as 0 | 1)}>
            <Text style={[styles.step, { color: i === step ? theme.accentPrimary : theme.textSecondary }]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {step === 0 && (
        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>Group</Text>
          <View style={styles.optionRow}>
            {groups.map((g) => (
              <Pressable
                key={g.groupId}
                onPress={() => selectGroup(g)}
                style={[styles.option, { backgroundColor: g.groupId === groupId ? theme.accentPrimary : theme.bgSecondary }]}
              >
                <Text style={{ color: g.groupId === groupId ? theme.bgPrimary : theme.textPrimary }}>{g.groupName}</Text>
              </Pressable>
            ))}
          </View>

          {members.length > 0 && (
            <>
              <Text style={[styles.label, { color: theme.textSecondary }]}>Payer</Text>
              <View style={styles.optionRow}>
                {members.map((m) => (
                  <Pressable
                    key={m.userId}
                    onPress={() => setPayerUserId(m.userId)}
                    style={[styles.option, { backgroundColor: m.userId === payerUserId ? theme.accentPrimary : theme.bgSecondary }]}
                  >
                    <Text style={{ color: m.userId === payerUserId ? theme.bgPrimary : theme.textPrimary }}>{m.username}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Text style={[styles.label, { color: theme.textSecondary }]}>Date</Text>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.textPrimary, borderColor: theme.textSecondary }]}
          />

          <Text style={[styles.label, { color: theme.textSecondary }]}>Amount</Text>
          <TextInput
            value={amountText}
            onChangeText={setAmountText}
            placeholder="0.00"
            keyboardType="decimal-pad"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.textPrimary, borderColor: theme.textSecondary }]}
          />

          <Text style={[styles.label, { color: theme.textSecondary }]}>Currency</Text>
          <TextInput
            value={currency}
            onChangeText={(t) => setCurrency(t.toUpperCase())}
            placeholder="INR"
            autoCapitalize="characters"
            maxLength={3}
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.textPrimary, borderColor: theme.textSecondary }]}
          />

          {stores.length > 0 && (
            <>
              <Text style={[styles.label, { color: theme.textSecondary }]}>Store (optional)</Text>
              <View style={styles.optionRow}>
                {stores.map((s) => (
                  <Pressable
                    key={s.storeId}
                    onPress={() => setStoreId(s.storeId === storeId ? null : s.storeId)}
                    style={[styles.option, { backgroundColor: s.storeId === storeId ? theme.accentPrimary : theme.bgSecondary }]}
                  >
                    <Text style={{ color: s.storeId === storeId ? theme.bgPrimary : theme.textPrimary }}>{s.storeName}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {paymentModes.length > 0 && (
            <>
              <Text style={[styles.label, { color: theme.textSecondary }]}>Payment mode (optional)</Text>
              <View style={styles.optionRow}>
                {paymentModes.map((p) => (
                  <Pressable
                    key={p.paymentModeId}
                    onPress={() => setPaymentModeId(p.paymentModeId === paymentModeId ? null : p.paymentModeId)}
                    style={[styles.option, { backgroundColor: p.paymentModeId === paymentModeId ? theme.accentPrimary : theme.bgSecondary }]}
                  >
                    <Text style={{ color: p.paymentModeId === paymentModeId ? theme.bgPrimary : theme.textPrimary }}>
                      {p.paymentModeName}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Text style={[styles.label, { color: theme.textSecondary }]}>Description (optional)</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.textPrimary, borderColor: theme.textSecondary }]}
          />

          <Pressable
            disabled={!canContinue}
            onPress={() => setStep(1)}
            style={[styles.primaryButton, { backgroundColor: canContinue ? theme.accentPrimary : theme.bgSecondary }]}
          >
            <Text style={{ color: canContinue ? theme.bgPrimary : theme.textSecondary }}>Next: Items</Text>
          </Pressable>
        </View>
      )}

      {step === 1 && (
        <View style={styles.section}>
          <Text style={{ color: theme.textSecondary }}>
            Leave this empty for a statement-only expense with no line items.
          </Text>
          {lines.map((l) => (
            <View key={l.key} style={styles.lineRow}>
              <TextInput
                value={l.productName}
                onChangeText={(t) => updateLine(l.key, { productName: t })}
                placeholder="Item"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, styles.lineName, { color: theme.textPrimary, borderColor: theme.textSecondary }]}
              />
              <TextInput
                value={l.amountText}
                onChangeText={(t) => updateLine(l.key, { amountText: t })}
                placeholder="0.00"
                keyboardType="decimal-pad"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, styles.lineAmount, { color: theme.textPrimary, borderColor: theme.textSecondary }]}
              />
              <Pressable onPress={() => removeLine(l.key)}>
                <Text style={{ color: theme.textSecondary }}>Remove</Text>
              </Pressable>
            </View>
          ))}
          <Pressable onPress={addLine} style={[styles.secondaryButton, { borderColor: theme.accentPrimary }]}>
            <Text style={{ color: theme.accentPrimary }}>Add item</Text>
          </Pressable>

          {error && <Text style={{ color: theme.accentSecondary }}>{error}</Text>}

          <Pressable
            disabled={saving}
            onPress={handleCreate}
            style={[styles.primaryButton, { backgroundColor: saving ? theme.bgSecondary : theme.accentPrimary }]}
          >
            <Text style={{ color: saving ? theme.textSecondary : theme.bgPrimary }}>
              {saving ? 'Saving...' : 'Create expense'}
            </Text>
          </Pressable>
        </View>
      )}

      <Pressable
        disabled={importing}
        onPress={handleImportStatement}
        style={[styles.secondaryButton, { borderColor: theme.accentPrimary }]}
      >
        <Text style={{ color: theme.accentPrimary }}>{importing ? 'Importing...' : 'Import bank statement'}</Text>
      </Pressable>
      {importError && <Text style={{ color: theme.accentSecondary }}>{importError}</Text>}

      <Pressable onPress={() => router.push('/scan-receipt')} style={[styles.secondaryButton, { borderColor: theme.accentPrimary }]}>
        <Text style={{ color: theme.accentPrimary }}>Scan receipt</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  stepRow: { flexDirection: 'row', gap: 16 },
  step: { fontSize: 18, fontWeight: 'bold' },
  section: { gap: 8 },
  label: { marginTop: 8 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  primaryButton: { marginTop: 16, padding: 14, borderRadius: 8, alignItems: 'center' },
  secondaryButton: { padding: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  lineRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  lineName: { flex: 2 },
  lineAmount: { flex: 1 },
});
