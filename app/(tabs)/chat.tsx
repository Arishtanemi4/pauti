import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useDatabase } from 'src/ui/DatabaseContext';
import { useTheme } from 'src/ui/theme';
import { formatMinorUnits } from 'src/core/money';
import { ContactBalance, getContactBalances } from 'src/db/queries/chat';

export default function ChatList() {
  const theme = useTheme();
  const { db, selfUserId } = useDatabase();
  const [contacts, setContacts] = useState<ContactBalance[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [balances, users] = await Promise.all([
        getContactBalances(db, selfUserId),
        db.getAllAsync<{ user_id: string; username: string }>('SELECT user_id, username FROM users'),
      ]);
      if (!cancelled) {
        setContacts(balances);
        setNames(Object.fromEntries(users.map((u) => [u.user_id, u.username])));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, selfUserId]);

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <FlatList
        data={contacts}
        keyExtractor={(item) => item.userId}
        renderItem={({ item }) => {
          const net = item.balances[0];
          const isOwedToMe = net !== undefined && net.amountMinorUnits > 0;
          return (
            <Link href={{ pathname: '/chat/[userId]', params: { userId: item.userId } }} asChild>
              <View style={styles.row}>
                <Text style={{ color: theme.textPrimary }}>{names[item.userId] ?? item.userId}</Text>
                {net && (
                  <Text style={{ color: isOwedToMe ? theme.accentPrimary : theme.textSecondary }}>
                    {formatMinorUnits(Math.abs(net.amountMinorUnits), net.currency)}
                  </Text>
                )}
              </View>
            </Link>
          );
        }}
        ListEmptyComponent={<Text style={{ color: theme.textSecondary }}>No contacts yet</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
});
