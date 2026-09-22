// Item-level split editor (docs/plan/EXECUTE.md §5.5): per-scope (each line, plus the
// header-scope unitemized remainder) split with partial shares and a live "remaining to
// allocate" readout that must read exactly zero before Save enables.
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useDatabase } from 'src/ui/DatabaseContext';
import { useTheme } from 'src/ui/theme';
import { formatMinorUnits, parseToMinorUnits } from 'src/core/money';
import { fraction } from 'src/core/money/fraction';
import { SplitMethod, SplitParticipant, computeSplit } from 'src/core/split';
import { writeToGroup } from 'src/crdt/store';
import { setSplitSet } from 'src/crdt/write';
import { SplitShare } from 'src/crdt/doc';
import { SplitEditorData, getSplitEditorData } from 'src/db/queries/split';
import { GroupMember, getGroupMembers } from 'src/db/queries/groups';

const MODES: SplitMethod[] = ['EQUAL', 'EXACT', 'PERCENT', 'SHARES'];

interface Scope {
  scopeKey: string;
  lineId: string | null;
  label: string;
  amountMinorUnits: number;
}

interface ScopeState {
  mode: SplitMethod;
  participantIds: string[];
  exactText: Record<string, string>;
  weightText: Record<string, string>;
}

function initialScopeState(): ScopeState {
  return { mode: 'EQUAL', participantIds: [], exactText: {}, weightText: {} };
}

function scopeRemaining(scope: Scope, state: ScopeState, currency: string): number {
  if (state.participantIds.length === 0) return scope.amountMinorUnits;

  if (state.mode === 'EXACT') {
    let sum = 0;
    for (const id of state.participantIds) {
      const text = state.exactText[id];
      if (!text) return scope.amountMinorUnits;
      let amount: number;
      try {
        amount = parseToMinorUnits(text, currency);
      } catch {
        return scope.amountMinorUnits;
      }
      sum += amount;
    }
    return scope.amountMinorUnits - sum;
  }

  if (state.mode === 'PERCENT' || state.mode === 'SHARES') {
    const allWeighted = state.participantIds.every((id) => Number(state.weightText[id]) > 0);
    return allWeighted ? 0 : scope.amountMinorUnits;
  }

  return 0; // EQUAL
}

export default function SplitEditor() {
  const { trxnId } = useLocalSearchParams<{ trxnId: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { db, selfDeviceId } = useDatabase();

  const [data, setData] = useState<SplitEditorData | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [scopeStates, setScopeStates] = useState<Record<string, ScopeState>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const editorData = await getSplitEditorData(db, trxnId);
      if (!editorData) return;
      const memberList = await getGroupMembers(db, editorData.groupId);
      if (!cancelled) {
        setData(editorData);
        setMembers(memberList);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, trxnId]);

  const scopes: Scope[] = useMemo(() => {
    if (!data) return [];
    const lineScopes: Scope[] = data.lines.map((l) => ({
      scopeKey: l.lineId,
      lineId: l.lineId,
      label: l.productName,
      amountMinorUnits: l.lineAmountMinorUnits,
    }));
    const lineSum = data.lines.reduce((a, l) => a + l.lineAmountMinorUnits, 0);
    const remainder = data.totalAmountMinorUnits - lineSum;
    if (data.lines.length === 0) {
      return [{ scopeKey: data.trxnId, lineId: null, label: 'Whole bill', amountMinorUnits: data.totalAmountMinorUnits }];
    }
    if (remainder > 0) {
      lineScopes.push({ scopeKey: data.trxnId, lineId: null, label: 'Remaining (unitemized)', amountMinorUnits: remainder });
    }
    return lineScopes;
  }, [data]);

  const stateFor = (scopeKey: string): ScopeState => scopeStates[scopeKey] ?? initialScopeState();

  const updateScope = (scopeKey: string, patch: Partial<ScopeState>) => {
    setScopeStates((prev) => ({ ...prev, [scopeKey]: { ...stateFor(scopeKey), ...patch } }));
  };

  const toggleParticipant = (scopeKey: string, userId: string) => {
    const state = stateFor(scopeKey);
    const participantIds = state.participantIds.includes(userId)
      ? state.participantIds.filter((id) => id !== userId)
      : [...state.participantIds, userId];
    updateScope(scopeKey, { participantIds });
  };

  const totalRemaining = data
    ? scopes.reduce((sum, scope) => sum + scopeRemaining(scope, stateFor(scope.scopeKey), data.currency), 0)
    : 0;
  const canSave = data !== null && scopes.length > 0 && totalRemaining === 0;

  const handleSave = async () => {
    if (!data) return;
    setError(null);
    setSaving(true);
    try {
      const now = new Date().toISOString();
      await writeToGroup(db, data.crdtDocId, selfDeviceId, (doc) => {
        for (const scope of scopes) {
          const state = stateFor(scope.scopeKey);
          const participants: SplitParticipant[] = state.participantIds.map((id) => {
            if (state.mode === 'EXACT') {
              return { id, amount: parseToMinorUnits(state.exactText[id] ?? '0', data.currency) };
            }
            if (state.mode === 'PERCENT') {
              return { id, weight: fraction(Number(state.weightText[id]), 100) };
            }
            if (state.mode === 'SHARES') {
              return { id, weight: fraction(Number(state.weightText[id]), 1) };
            }
            return { id };
          });
          const computed = computeSplit(scope.amountMinorUnits, state.mode, participants);
          const shares: SplitShare[] = Object.entries(computed).map(([debtorId, owedAmount]) => ({
            debtorId,
            owedAmount,
            currency: data.currency,
            splitMode: state.mode,
            weightNum: state.mode === 'PERCENT' ? Number(state.weightText[debtorId]) : state.mode === 'SHARES' ? Number(state.weightText[debtorId]) : 1,
            weightDen: state.mode === 'PERCENT' ? 100 : 1,
          }));
          setSplitSet(doc, selfDeviceId, {
            scopeKey: scope.scopeKey,
            trxnId: data.trxnId,
            lineId: scope.lineId,
            shares,
            updatedAt: now,
            updatedByDeviceId: selfDeviceId,
          });
        }
      });
      router.replace({ pathname: '/groups/[groupId]', params: { groupId: data.groupId } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!data) {
    return (
      <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
        <Text style={{ color: theme.textSecondary }}>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.bgPrimary }]} contentContainerStyle={styles.content}>
      {scopes.map((scope) => {
        const state = stateFor(scope.scopeKey);
        const remaining = scopeRemaining(scope, state, data.currency);
        return (
          <View key={scope.scopeKey} style={styles.scopeCard}>
            <Text style={[styles.scopeTitle, { color: theme.textPrimary }]}>{scope.label}</Text>
            <Text style={{ color: theme.textSecondary }}>{formatMinorUnits(scope.amountMinorUnits, data.currency)}</Text>

            <View style={styles.optionRow}>
              {MODES.map((mode) => (
                <Pressable
                  key={mode}
                  onPress={() => updateScope(scope.scopeKey, { mode })}
                  style={[styles.option, { backgroundColor: mode === state.mode ? theme.accentPrimary : theme.bgSecondary }]}
                >
                  <Text style={{ color: mode === state.mode ? theme.bgPrimary : theme.textPrimary }}>{mode}</Text>
                </Pressable>
              ))}
            </View>

            {members.map((m) => {
              const selected = state.participantIds.includes(m.userId);
              return (
                <View key={m.userId} style={styles.participantRow}>
                  <Pressable
                    onPress={() => toggleParticipant(scope.scopeKey, m.userId)}
                    style={[styles.option, { backgroundColor: selected ? theme.accentPrimary : theme.bgSecondary }]}
                  >
                    <Text style={{ color: selected ? theme.bgPrimary : theme.textPrimary }}>{m.username}</Text>
                  </Pressable>
                  {selected && state.mode === 'EXACT' && (
                    <TextInput
                      value={state.exactText[m.userId] ?? ''}
                      onChangeText={(t) => updateScope(scope.scopeKey, { exactText: { ...state.exactText, [m.userId]: t } })}
                      placeholder="0.00"
                      keyboardType="decimal-pad"
                      placeholderTextColor={theme.textSecondary}
                      style={[styles.weightInput, { color: theme.textPrimary, borderColor: theme.textSecondary }]}
                    />
                  )}
                  {selected && (state.mode === 'PERCENT' || state.mode === 'SHARES') && (
                    <TextInput
                      value={state.weightText[m.userId] ?? ''}
                      onChangeText={(t) => updateScope(scope.scopeKey, { weightText: { ...state.weightText, [m.userId]: t } })}
                      placeholder={state.mode === 'PERCENT' ? '%' : 'shares'}
                      keyboardType="decimal-pad"
                      placeholderTextColor={theme.textSecondary}
                      style={[styles.weightInput, { color: theme.textPrimary, borderColor: theme.textSecondary }]}
                    />
                  )}
                </View>
              );
            })}

            <Text style={{ color: remaining === 0 ? theme.accentPrimary : theme.accentSecondary }}>
              Remaining to allocate: {formatMinorUnits(remaining, data.currency)}
            </Text>
          </View>
        );
      })}

      {error && <Text style={{ color: theme.accentSecondary }}>{error}</Text>}

      <Text style={{ color: totalRemaining === 0 ? theme.accentPrimary : theme.accentSecondary }}>
        Total remaining to allocate: {formatMinorUnits(totalRemaining, data.currency)}
      </Text>

      <Pressable
        disabled={!canSave || saving}
        onPress={handleSave}
        style={[styles.primaryButton, { backgroundColor: canSave && !saving ? theme.accentPrimary : theme.bgSecondary }]}
      >
        <Text style={{ color: canSave && !saving ? theme.bgPrimary : theme.textSecondary }}>{saving ? 'Saving...' : 'Save'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 16 },
  scopeCard: { gap: 8 },
  scopeTitle: { fontSize: 16, fontWeight: 'bold' },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  participantRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weightInput: { borderWidth: 1, borderRadius: 8, padding: 8, width: 90 },
  primaryButton: { marginTop: 8, padding: 14, borderRadius: 8, alignItems: 'center' },
});
