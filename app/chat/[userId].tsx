import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useDatabase } from 'src/ui/DatabaseContext';
import { useTheme } from 'src/ui/theme';
import { formatMinorUnits } from 'src/core/money';
import { getThread, ThreadItem } from 'src/db/queries/chat';

export default function ChatThread() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const theme = useTheme();
  const { db, selfUserId } = useDatabase();
  const [items, setItems] = useState<ThreadItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const thread = await getThread(db, selfUserId, userId);
      if (!cancelled) setItems(thread);
    })();
    return () => {
      cancelled = true;
    };
  }, [db, selfUserId, userId]);

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
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
});
