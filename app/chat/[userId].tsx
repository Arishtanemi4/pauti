import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useDatabase } from 'src/ui/DatabaseContext';
import { useTheme } from 'src/ui/theme';
import { formatMinorUnits } from 'src/core/money';
import { ContactBalance, getContactBalances, getThread, ThreadItem } from 'src/db/queries/chat';
import { recordSettlement } from 'src/crdt/settle';

export default function ChatThread() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const theme = useTheme();
  const { db, selfUserId, selfDeviceId } = useDatabase();
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [balance, setBalance] = useState<ContactBalance | undefined>(undefined);
  const [settling, setSettling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [thread, balances] = await Promise.all([
      getThread(db, selfUserId, userId),
      getContactBalances(db, selfUserId),
    ]);
    setItems(thread);
    setBalance(balances.find((b) => b.userId === userId));
  };

  useEffect(() => {
    load();
  }, [db, selfUserId, userId]);

  const handleSettle = async (currency: string, netAmountMinorUnits: number) => {
    setError(null);
    setSettling(currency);
    try {
      const fromUserId = netAmountMinorUnits < 0 ? selfUserId : userId;
      const toUserId = netAmountMinorUnits < 0 ? userId : selfUserId;
      await recordSettlement(db, selfDeviceId, fromUserId, toUserId, Math.abs(netAmountMinorUnits), currency);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSettling(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      {balance?.balances.map((b) => (
        <View key={b.currency} style={styles.settleRow}>
          <Text style={{ color: theme.textPrimary }}>
            {b.amountMinorUnits > 0 ? 'Owed to you' : 'You owe'}: {formatMinorUnits(Math.abs(b.amountMinorUnits), b.currency)}
          </Text>
          <Pressable
            disabled={settling === b.currency}
            onPress={() => handleSettle(b.currency, b.amountMinorUnits)}
            style={[styles.settleButton, { backgroundColor: theme.accentPrimary }]}
          >
            <Text style={{ color: theme.bgPrimary }}>{settling === b.currency ? 'Settling...' : 'Settle up'}</Text>
          </Pressable>
        </View>
      ))}
      {error && <Text style={{ color: theme.accentSecondary }}>{error}</Text>}

      <FlatList
        data={items}
        keyExtractor={(item) => `${item.kind}_${item.id}`}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={{ color: theme.textSecondary }}>{item.date}</Text>
            <Text style={{ color: theme.textPrimary }}>{item.description}</Text>
            <Text style={{ color: theme.textPrimary }}>{formatMinorUnits(item.amountMinorUnits, item.currency)}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={{ color: theme.textSecondary }}>No shared expenses yet</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  row: { paddingVertical: 8 },
  settleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  settleButton: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
});
