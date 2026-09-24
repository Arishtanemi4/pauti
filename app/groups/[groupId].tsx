import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useDatabase } from 'src/ui/DatabaseContext';
import { useTheme } from 'src/ui/theme';
import { formatMinorUnits } from 'src/core/money';
import { simplifyDebts, Settlement } from 'src/core/balance';
import { GroupBalances, GroupDetail as GroupDetailRow, GroupMember, getGroupBalances, getGroupDetail, getGroupMembers } from 'src/db/queries/groups';
import { recordSettlement } from 'src/crdt/settle';

export default function GroupDetail() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { db, selfDeviceId } = useDatabase();
  const [detail, setDetail] = useState<GroupDetailRow | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [balances, setBalances] = useState<GroupBalances[]>([]);
  const [settling, setSettling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [groupDetail, memberList, balanceList] = await Promise.all([
      getGroupDetail(db, groupId),
      getGroupMembers(db, groupId),
      getGroupBalances(db, groupId),
    ]);
    setDetail(groupDetail);
    setMembers(memberList);
    setBalances(balanceList);
  };

  useEffect(() => {
    load();
  }, [db, groupId]);

  const nameFor = (userId: string) => members.find((m) => m.userId === userId)?.username ?? userId;

  const handleSettle = async (settlement: Settlement, currency: string) => {
    const key = `${settlement.from}_${settlement.to}_${currency}`;
    setError(null);
    setSettling(key);
    try {
      await recordSettlement(db, selfDeviceId, settlement.from, settlement.to, settlement.amountMinorUnits, currency, groupId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSettling(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Members</Text>
      {members.map((m) => (
        <Text key={m.userId} style={{ color: theme.textPrimary }}>
          {m.username}
        </Text>
      ))}
      {detail && (
        <Pressable
          onPress={() =>
            router.push({
              pathname: '/pair',
              params: {
                groupId: detail.groupId,
                crdtDocId: detail.crdtDocId,
                groupName: detail.groupName,
                defaultCurrency: detail.defaultCurrency,
                isPair: detail.isPair ? '1' : '0',
              },
            })
          }
          style={[styles.addMemberButton, { borderColor: theme.textSecondary }]}
        >
          <Text style={{ color: theme.textPrimary }}>Add member</Text>
        </Pressable>
      )}

      <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Balances</Text>
      {balances.map(({ currency, memberNet }) => (
        <View key={currency} style={styles.section}>
          {Object.entries(memberNet).map(([userId, amount]) => (
            <Text key={userId} style={{ color: theme.textSecondary }}>
              {nameFor(userId)}: {formatMinorUnits(amount, currency)}
            </Text>
          ))}
        </View>
      ))}

      <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Simplified debts</Text>
      {error && <Text style={{ color: theme.accentSecondary }}>{error}</Text>}
      {balances.map(({ currency, memberNet }) => {
        const settlements: Settlement[] = simplifyDebts(memberNet);
        return settlements.map((s) => {
          const key = `${s.from}_${s.to}_${currency}`;
          return (
            <View key={key} style={styles.settleRow}>
              <Text style={{ color: theme.textPrimary }}>
                {nameFor(s.from)} owes {nameFor(s.to)} {formatMinorUnits(s.amountMinorUnits, currency)}
              </Text>
              <Pressable
                disabled={settling === key}
                onPress={() => handleSettle(s, currency)}
                style={[styles.settleButton, { backgroundColor: theme.accentPrimary }]}
              >
                <Text style={{ color: theme.bgPrimary }}>{settling === key ? 'Settling...' : 'Settle up'}</Text>
              </Pressable>
            </View>
          );
        });
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', marginTop: 16, marginBottom: 8 },
  section: { marginBottom: 8 },
  settleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  settleButton: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  addMemberButton: { marginTop: 8, padding: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
});
