import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useDatabase } from 'src/ui/DatabaseContext';
import { useTheme } from 'src/ui/theme';
import { formatMinorUnits } from 'src/core/money';
import { simplifyDebts, Settlement } from 'src/core/balance';
import { getGroupBalances, getGroupMembers, GroupBalances, GroupMember } from 'src/db/queries/groups';

export default function GroupDetail() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const theme = useTheme();
  const { db } = useDatabase();
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [balances, setBalances] = useState<GroupBalances[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [memberList, balanceList] = await Promise.all([getGroupMembers(db, groupId), getGroupBalances(db, groupId)]);
      if (!cancelled) {
        setMembers(memberList);
        setBalances(balanceList);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, groupId]);

  const nameFor = (userId: string) => members.find((m) => m.userId === userId)?.username ?? userId;

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Members</Text>
      {members.map((m) => (
        <Text key={m.userId} style={{ color: theme.textPrimary }}>
          {m.username}
        </Text>
      ))}

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
      {balances.map(({ currency, memberNet }) => {
        const settlements: Settlement[] = simplifyDebts(memberNet);
        return settlements.map((s) => (
          <Text key={`${s.from}_${s.to}_${currency}`} style={{ color: theme.textPrimary }}>
            {nameFor(s.from)} owes {nameFor(s.to)} {formatMinorUnits(s.amountMinorUnits, currency)}
          </Text>
        ));
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', marginTop: 16, marginBottom: 8 },
  section: { marginBottom: 8 },
});
