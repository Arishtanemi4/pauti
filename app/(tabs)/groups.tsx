import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useDatabase } from 'src/ui/DatabaseContext';
import { useTheme } from 'src/ui/theme';
import { formatMinorUnits } from 'src/core/money';
import { getGroupList, GroupListItem } from 'src/db/queries/groups';

export default function GroupsList() {
  const theme = useTheme();
  const { db, selfUserId } = useDatabase();
  const [groups, setGroups] = useState<GroupListItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await getGroupList(db, selfUserId);
      if (!cancelled) setGroups(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [db, selfUserId]);

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <FlatList
        data={groups}
        keyExtractor={(item) => item.groupId}
        renderItem={({ item }) => (
          <Link href={{ pathname: '/groups/[groupId]', params: { groupId: item.groupId } }} asChild>
            <View style={styles.row}>
              <Text style={{ color: theme.textPrimary }}>{item.groupName}</Text>
              {item.netPosition.map((n) => (
                <Text key={n.currency} style={{ color: theme.textSecondary }}>
                  {formatMinorUnits(n.amountMinorUnits, n.currency)}
                </Text>
              ))}
            </View>
          </Link>
        )}
        ListEmptyComponent={<Text style={{ color: theme.textSecondary }}>No groups yet</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
});
