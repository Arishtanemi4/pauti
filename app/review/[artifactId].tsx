// Statement import review gate (docs/plan/EXECUTE.md §5.6, Phase 6 task 6.5): the only
// screen allowed to turn a parsed draft into statement_entries rows. Nothing skips this.
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useDatabase } from 'src/ui/DatabaseContext';
import { useTheme } from 'src/ui/theme';
import { formatMinorUnits, parseToMinorUnits } from 'src/core/money';
import { ParsedStatement, StatementDraftEntry } from 'src/parse/statement';
import { OcrArtifact, getOcrArtifact } from 'src/db/queries/review';
import { acceptStatementEntries, getUserDefaultCurrency, rejectArtifact } from 'src/db/queries/statements';
import {
  ReconciliationCandidateTransaction,
  UnmatchedStatementEntry,
  computeMatchSuggestions,
  confirmMatch,
  getStatementEntriesByIds,
  getTransactionsByIds,
  ignoreMatch,
} from 'src/db/queries/reconcile';

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

export default function ReviewStatement() {
  const { artifactId } = useLocalSearchParams<{ artifactId: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { db, selfUserId } = useDatabase();

  const [artifact, setArtifact] = useState<OcrArtifact | null | undefined>(undefined);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [currency, setCurrency] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [savedEntries, setSavedEntries] = useState<UnmatchedStatementEntry[] | null>(null);
  const [matchedTxns, setMatchedTxns] = useState<Record<string, ReconciliationCandidateTransaction>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [found, defaultCurrency] = await Promise.all([
        getOcrArtifact(db, artifactId),
        getUserDefaultCurrency(db, selfUserId),
      ]);
      if (cancelled) return;
      setArtifact(found ?? null);
      setCurrency(defaultCurrency);
      if (found?.parsedJson) {
        const parsed: ParsedStatement = JSON.parse(found.parsedJson);
        setRows(parsed.entries.map((e) => toDraftRow(e, defaultCurrency)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, selfUserId, artifactId]);

  const includedCount = useMemo(() => rows.filter((r) => r.included).length, [rows]);

  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const handleReject = async () => {
    await rejectArtifact(db, artifactId);
    router.back();
  };

  const handleSave = async () => {
    if (!artifact) return;
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
        <Text style={{ color: theme.textSecondary }}>Statement not found.</Text>
      </View>
    );
  }

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

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 18, fontWeight: 'bold' },
  label: { marginTop: 8 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10 },
  amountInput: { flex: 1 },
  row: { gap: 6, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#8888' },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  option: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  primaryButton: { marginTop: 8, padding: 14, borderRadius: 8, alignItems: 'center' },
  secondaryButton: { padding: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
});
