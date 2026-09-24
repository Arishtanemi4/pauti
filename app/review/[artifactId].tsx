// OCR/import review gate (docs/plan/EXECUTE.md §5.6): the only screen allowed to turn a
// parsed draft into ledger data. Nothing skips this. One route, dispatching on
// `artifact.kind` — STATEMENT entries land in the private statement_entries table (Phase 6),
// RECEIPT items become a real transaction via src/crdt/write.ts (Phase 7, task 7.2; see
// docs/ocr/OCR.md).
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SqliteExecutor } from 'src/db/migrations/runner';
import { useDatabase } from 'src/ui/DatabaseContext';
import { useTheme } from 'src/ui/theme';
import { formatMinorUnits, parseToMinorUnits } from 'src/core/money';
import { newId } from 'src/core/id';
import { writeToGroup } from 'src/crdt/store';
import { createTransaction, setLine } from 'src/crdt/write';
import { ParsedStatement, StatementDraftEntry } from 'src/parse/statement';
import { ParsedReceipt } from 'src/parse/receipt';
import { OcrArtifact, getOcrArtifact } from 'src/db/queries/review';
import { acceptStatementEntries, getUserDefaultCurrency, rejectArtifact } from 'src/db/queries/statements';
import { acceptReceiptArtifact } from 'src/db/queries/receipts';
import { GroupOption, StoreOption, getGroupOptions, getStoreOptions } from 'src/db/queries/add';
import { GroupMember, getGroupMembers } from 'src/db/queries/groups';
import {
  ReconciliationCandidateTransaction,
  UnmatchedStatementEntry,
  computeMatchSuggestions,
  confirmMatch,
  getStatementEntriesByIds,
  getSuggestedMatchForTransaction,
  getTransactionsByIds,
  ignoreMatch,
} from 'src/db/queries/reconcile';

export default function Review() {
  const { artifactId } = useLocalSearchParams<{ artifactId: string }>();
  const theme = useTheme();
  const { db } = useDatabase();

  const [artifact, setArtifact] = useState<OcrArtifact | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found = await getOcrArtifact(db, artifactId);
      if (!cancelled) setArtifact(found ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [db, artifactId]);

  if (artifact === undefined) {
    return (
      <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
        <Text style={{ color: theme.textSecondary }}>Loading...</Text>
      </View>
    );
  }

  if (artifact === null) {
    return (
      <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
        <Text style={{ color: theme.textSecondary }}>Not found.</Text>
      </View>
    );
  }

  return artifact.kind === 'RECEIPT' ? (
    <ReviewReceipt artifactId={artifactId} artifact={artifact} />
  ) : (
    <ReviewStatement artifactId={artifactId} artifact={artifact} />
  );
}

// ----------------------------------------------------------------------------
// Statement review (Phase 6, task 6.5)
// ----------------------------------------------------------------------------

interface DraftRow {
  key: string;
  included: boolean;
  date: string;
  description: string;
  amountText: string; // always a positive magnitude
  isCredit: boolean;
  balanceAfterMinorUnits: number | null;
  signResolved: boolean;
}

function toDraftRow(entry: StatementDraftEntry, currency: string): DraftRow {
  return {
    key: `${entry.date}-${entry.description}-${entry.amountMinorUnits}`,
    included: true,
    date: entry.date,
    description: entry.description,
    amountText: formatMinorUnits(Math.abs(entry.amountMinorUnits), currency).replace(/[^0-9.,]/g, ''),
    isCredit: entry.amountMinorUnits >= 0,
    balanceAfterMinorUnits: entry.balanceAfterMinorUnits,
    signResolved: entry.signResolved,
  };
}

function ReviewStatement({ artifactId, artifact }: { artifactId: string; artifact: OcrArtifact }) {
  const theme = useTheme();
  const router = useRouter();
  const { db, selfUserId } = useDatabase();

  const [rows, setRows] = useState<DraftRow[]>([]);
  const [currency, setCurrency] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [savedEntries, setSavedEntries] = useState<UnmatchedStatementEntry[] | null>(null);
  const [matchedTxns, setMatchedTxns] = useState<Record<string, ReconciliationCandidateTransaction>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const defaultCurrency = await getUserDefaultCurrency(db, selfUserId);
      if (cancelled) return;
      setCurrency(defaultCurrency);
      if (artifact.parsedJson) {
        const parsed: ParsedStatement = JSON.parse(artifact.parsedJson);
        setRows(parsed.entries.map((e) => toDraftRow(e, defaultCurrency)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, selfUserId, artifact.parsedJson]);

  const includedCount = useMemo(() => rows.filter((r) => r.included).length, [rows]);

  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const handleReject = async () => {
    await rejectArtifact(db, artifactId);
    router.back();
  };

  const handleSave = async () => {
    setError(null);
    if (currency.length !== 3) {
      setError('Currency must be a 3-letter code');
      return;
    }

    const included = rows.filter((r) => r.included);
    let entries: StatementDraftEntry[];
    try {
      entries = included.map((r) => ({
        date: r.date,
        description: r.description,
        amountMinorUnits: parseToMinorUnits(r.amountText, currency) * (r.isCredit ? 1 : -1),
        balanceAfterMinorUnits: r.balanceAfterMinorUnits,
        signResolved: true,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }

    setSaving(true);
    try {
      const entryIds = await acceptStatementEntries(db, {
        artifactId,
        userId: selfUserId,
        currency,
        sourceFileReference: artifact.fileUri,
        entries,
      });
      await computeMatchSuggestions(db, selfUserId, currency);

      const accepted = await getStatementEntriesByIds(db, entryIds);
      setSavedEntries(accepted);

      const trxnIds = accepted.map((e) => e.matchedTrxnId).filter((id): id is string => id !== null);
      const txns = await getTransactionsByIds(db, trxnIds);
      setMatchedTxns(Object.fromEntries(txns.map((t) => [t.trxnId, t])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async (entryId: string, trxnId: string) => {
    await confirmMatch(db, entryId, trxnId);
    setSavedEntries((prev) => prev?.map((e) => (e.entryId === entryId ? { ...e, matchStatus: 'CONFIRMED' } : e)) ?? null);
  };

  const handleIgnore = async (entryId: string) => {
    await ignoreMatch(db, entryId);
    setSavedEntries((prev) => prev?.map((e) => (e.entryId === entryId ? { ...e, matchStatus: 'IGNORED' } : e)) ?? null);
  };

  if (artifact.reviewStatus !== 'PENDING' && savedEntries === null) {
    return (
      <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
        <Text style={{ color: theme.textSecondary }}>This statement was already {artifact.reviewStatus.toLowerCase()}.</Text>
      </View>
    );
  }

  if (savedEntries !== null) {
    return (
      <ScrollView style={[styles.container, { backgroundColor: theme.bgPrimary }]} contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>Saved {savedEntries.length} entries</Text>
        {savedEntries
          .filter((e) => e.matchStatus === 'SUGGESTED')
          .map((e) => {
            const txn = e.matchedTrxnId ? matchedTxns[e.matchedTrxnId] : undefined;
            return (
              <View key={e.entryId} style={styles.row}>
                <Text style={{ color: theme.textPrimary }}>
                  {e.statementDate} · {e.description} · {formatMinorUnits(e.amountMinorUnits, e.currency)}
                </Text>
                {txn && (
                  <Text style={{ color: theme.textSecondary }}>
                    Suggested match: {txn.description ?? 'expense'} on {txn.trxnDate} for{' '}
                    {formatMinorUnits(txn.totalAmount, e.currency)}
                  </Text>
                )}
                <View style={styles.optionRow}>
                  <Pressable
                    onPress={() => e.matchedTrxnId && handleConfirm(e.entryId, e.matchedTrxnId)}
                    style={[styles.option, { backgroundColor: theme.accentPrimary }]}
                  >
                    <Text style={{ color: theme.bgPrimary }}>Confirm</Text>
                  </Pressable>
                  <Pressable onPress={() => handleIgnore(e.entryId)} style={[styles.option, { backgroundColor: theme.bgSecondary }]}>
                    <Text style={{ color: theme.textPrimary }}>Ignore</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
      </ScrollView>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.bgPrimary }]} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: theme.textPrimary }]}>Review statement</Text>

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

      {rows.map((row) => (
        <View key={row.key} style={styles.row}>
          <View style={styles.optionRow}>
            <Switch value={row.included} onValueChange={(v) => updateRow(row.key, { included: v })} />
            <Text style={{ color: theme.textSecondary }}>{row.included ? 'Include' : 'Skip'}</Text>
            {!row.signResolved && <Text style={{ color: theme.accentSecondary }}>Verify credit/debit</Text>}
          </View>
          <TextInput
            value={row.date}
            onChangeText={(t) => updateRow(row.key, { date: t })}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.textPrimary, borderColor: theme.textSecondary }]}
          />
          <TextInput
            value={row.description}
            onChangeText={(t) => updateRow(row.key, { description: t })}
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.textPrimary, borderColor: theme.textSecondary }]}
          />
          <View style={styles.optionRow}>
            <TextInput
              value={row.amountText}
              onChangeText={(t) => updateRow(row.key, { amountText: t })}
              placeholder="0.00"
              keyboardType="decimal-pad"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, styles.amountInput, { color: theme.textPrimary, borderColor: theme.textSecondary }]}
            />
            <Pressable
              onPress={() => updateRow(row.key, { isCredit: !row.isCredit })}
              style={[styles.option, { backgroundColor: row.isCredit ? theme.accentPrimary : theme.bgSecondary }]}
            >
              <Text style={{ color: row.isCredit ? theme.bgPrimary : theme.textPrimary }}>
                {row.isCredit ? 'Credit' : 'Debit'}
              </Text>
            </Pressable>
          </View>
        </View>
      ))}

      {error && <Text style={{ color: theme.accentSecondary }}>{error}</Text>}

      <Text style={{ color: theme.textSecondary }}>{includedCount} of {rows.length} entries will be saved</Text>

      <Pressable
        disabled={saving}
        onPress={handleSave}
        style={[styles.primaryButton, { backgroundColor: saving ? theme.bgSecondary : theme.accentPrimary }]}
      >
        <Text style={{ color: saving ? theme.textSecondary : theme.bgPrimary }}>{saving ? 'Saving...' : 'Save to ledger'}</Text>
      </Pressable>

      <Pressable disabled={saving} onPress={handleReject} style={[styles.secondaryButton, { borderColor: theme.accentSecondary }]}>
        <Text style={{ color: theme.accentSecondary }}>Reject this import</Text>
      </Pressable>
    </ScrollView>
  );
}

// ----------------------------------------------------------------------------
// Receipt review (Phase 7, task 7.2)
// ----------------------------------------------------------------------------

interface ReceiptRow {
  key: string;
  included: boolean;
  name: string;
  priceText: string;
}

function toReceiptRow(item: { name: string; priceMinorUnits: number }, currency: string, i: number): ReceiptRow {
  return {
    key: `${i}-${item.name}`,
    included: true,
    name: item.name,
    priceText: formatMinorUnits(item.priceMinorUnits, currency).replace(/[^0-9.,]/g, ''),
  };
}

async function findMatchingStoreId(db: SqliteExecutor, storeName: string | null): Promise<string | null> {
  if (!storeName) return null;
  const stores = await getStoreOptions(db);
  const match = stores.find((s) => s.storeName.toLowerCase() === storeName.toLowerCase());
  return match?.storeId ?? null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function ReviewReceipt({ artifactId, artifact }: { artifactId: string; artifact: OcrArtifact }) {
  const theme = useTheme();
  const router = useRouter();
  const { db, selfUserId, selfDeviceId } = useDatabase();

  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [payerUserId, setPayerUserId] = useState<string | null>(null);
  const [currency, setCurrency] = useState('');
  const [date, setDate] = useState(todayIso());
  const [storeName, setStoreName] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [totalText, setTotalText] = useState('');
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [savedTrxnId, setSavedTrxnId] = useState<string | null>(null);
  const [suggestedMatch, setSuggestedMatch] = useState<UnmatchedStatementEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [groupList, defaultCurrency] = await Promise.all([
        getGroupOptions(db, selfUserId),
        getUserDefaultCurrency(db, selfUserId),
      ]);
      if (cancelled) return;
      setGroups(groupList);
      setCurrency(defaultCurrency);

      if (artifact.parsedJson) {
        const parsed: ParsedReceipt = JSON.parse(artifact.parsedJson);
        setRows(parsed.items.map((item, i) => toReceiptRow(item, defaultCurrency, i)));
        if (parsed.date) setDate(parsed.date);
        if (parsed.totalMinorUnits !== null) {
          setTotalText(formatMinorUnits(parsed.totalMinorUnits, defaultCurrency).replace(/[^0-9.,]/g, ''));
        }
        setStoreName(parsed.storeName);
        const matchedStoreId = await findMatchingStoreId(db, parsed.storeName);
        if (!cancelled) setStoreId(matchedStoreId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, selfUserId, artifact.parsedJson]);

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

  const includedCount = useMemo(() => rows.filter((r) => r.included).length, [rows]);

  const updateRow = (key: string, patch: Partial<ReceiptRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const handleReject = async () => {
    await rejectArtifact(db, artifactId);
    router.back();
  };

  const handleSave = async () => {
    setError(null);
    if (!groupId || !payerUserId) {
      setError('Choose a group and a payer');
      return;
    }
    const group = groups.find((g) => g.groupId === groupId);
    if (!group) return;
    if (currency.length !== 3) {
      setError('Currency must be a 3-letter code');
      return;
    }

    const included = rows.filter((r) => r.included);
    let lineAmounts: number[];
    let totalAmountMinorUnits: number;
    try {
      lineAmounts = included.map((r) => parseToMinorUnits(r.priceText, currency));
      const lineSum = lineAmounts.reduce((a, b) => a + b, 0);
      totalAmountMinorUnits = totalText.trim().length > 0 ? parseToMinorUnits(totalText, currency) : lineSum;
      if (totalAmountMinorUnits <= 0) {
        setError('Total must be greater than zero');
        return;
      }
      if (lineSum > totalAmountMinorUnits) {
        setError('Line items add up to more than the total amount');
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
          paymentModeId: null,
          trxnDate: date,
          description: storeName,
          totalAmount: totalAmountMinorUnits,
          currency,
          detailLevel: included.length > 0 ? 'ITEMIZED' : 'HEADER_ONLY',
          sourceType: 'RECEIPT_OCR',
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
        included.forEach((r, i) => {
          setLine(doc, selfDeviceId, {
            lineId: newId('lin'),
            trxnId,
            lineNo: i + 1,
            productName: r.name,
            quantityNum: 1,
            quantityDen: 1,
            unitPrice: null,
            lineAmount: lineAmounts[i],
            deletedAt: null,
          });
        });
      });

      await acceptReceiptArtifact(db, artifactId, trxnId);
      await computeMatchSuggestions(db, selfUserId, currency);
      const suggested = await getSuggestedMatchForTransaction(db, trxnId);

      setSavedTrxnId(trxnId);
      setSuggestedMatch(suggested ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmSuggested = async () => {
    if (!suggestedMatch || !savedTrxnId) return;
    await confirmMatch(db, suggestedMatch.entryId, savedTrxnId);
    setSuggestedMatch({ ...suggestedMatch, matchStatus: 'CONFIRMED' });
  };

  const handleIgnoreSuggested = async () => {
    if (!suggestedMatch) return;
    await ignoreMatch(db, suggestedMatch.entryId);
    setSuggestedMatch({ ...suggestedMatch, matchStatus: 'IGNORED' });
  };

  if (artifact.reviewStatus !== 'PENDING' && savedTrxnId === null) {
    return (
      <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
        <Text style={{ color: theme.textSecondary }}>This receipt was already {artifact.reviewStatus.toLowerCase()}.</Text>
      </View>
    );
  }

  if (savedTrxnId !== null) {
    return (
      <ScrollView style={[styles.container, { backgroundColor: theme.bgPrimary }]} contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>Saved to ledger</Text>

        {suggestedMatch && suggestedMatch.matchStatus === 'SUGGESTED' && (
          <View style={styles.row}>
            <Text style={{ color: theme.textPrimary }}>
              Suggested match: {suggestedMatch.description} on {suggestedMatch.statementDate} for{' '}
              {formatMinorUnits(-suggestedMatch.amountMinorUnits, suggestedMatch.currency)}
            </Text>
            <View style={styles.optionRow}>
              <Pressable onPress={handleConfirmSuggested} style={[styles.option, { backgroundColor: theme.accentPrimary }]}>
                <Text style={{ color: theme.bgPrimary }}>Confirm</Text>
              </Pressable>
              <Pressable onPress={handleIgnoreSuggested} style={[styles.option, { backgroundColor: theme.bgSecondary }]}>
                <Text style={{ color: theme.textPrimary }}>Ignore</Text>
              </Pressable>
            </View>
          </View>
        )}

        <Pressable
          onPress={() => router.replace({ pathname: '/split/[trxnId]', params: { trxnId: savedTrxnId } })}
          style={[styles.primaryButton, { backgroundColor: theme.accentPrimary }]}
        >
          <Text style={{ color: theme.bgPrimary }}>Continue to split</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.bgPrimary }]} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: theme.textPrimary }]}>Review receipt</Text>
      {storeName && <Text style={{ color: theme.textSecondary }}>{storeName}</Text>}

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

      {rows.map((row) => (
        <View key={row.key} style={styles.row}>
          <View style={styles.optionRow}>
            <Switch value={row.included} onValueChange={(v) => updateRow(row.key, { included: v })} />
            <Text style={{ color: theme.textSecondary }}>{row.included ? 'Include' : 'Skip'}</Text>
          </View>
          <View style={styles.lineRow}>
            <TextInput
              value={row.name}
              onChangeText={(t) => updateRow(row.key, { name: t })}
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, styles.lineName, { color: theme.textPrimary, borderColor: theme.textSecondary }]}
            />
            <TextInput
              value={row.priceText}
              onChangeText={(t) => updateRow(row.key, { priceText: t })}
              placeholder="0.00"
              keyboardType="decimal-pad"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, styles.lineAmount, { color: theme.textPrimary, borderColor: theme.textSecondary }]}
            />
          </View>
        </View>
      ))}

      <Text style={[styles.label, { color: theme.textSecondary }]}>Total</Text>
      <TextInput
        value={totalText}
        onChangeText={setTotalText}
        placeholder="0.00"
        keyboardType="decimal-pad"
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.textPrimary, borderColor: theme.textSecondary }]}
      />

      {error && <Text style={{ color: theme.accentSecondary }}>{error}</Text>}

      <Text style={{ color: theme.textSecondary }}>{includedCount} of {rows.length} items will be saved</Text>

      <Pressable
        disabled={saving}
        onPress={handleSave}
        style={[styles.primaryButton, { backgroundColor: saving ? theme.bgSecondary : theme.accentPrimary }]}
      >
        <Text style={{ color: saving ? theme.textSecondary : theme.bgPrimary }}>{saving ? 'Saving...' : 'Save to ledger'}</Text>
      </Pressable>

      <Pressable disabled={saving} onPress={handleReject} style={[styles.secondaryButton, { borderColor: theme.accentSecondary }]}>
        <Text style={{ color: theme.accentSecondary }}>Reject this receipt</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 18, fontWeight: 'bold' },
  label: { marginTop: 8 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10 },
  amountInput: { flex: 1 },
  row: { gap: 6, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#8888' },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  option: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  primaryButton: { marginTop: 8, padding: 14, borderRadius: 8, alignItems: 'center' },
  secondaryButton: { padding: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  lineRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  lineName: { flex: 2 },
  lineAmount: { flex: 1 },
});
