import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useDatabase } from 'src/ui/DatabaseContext';
import { useTheme } from 'src/ui/theme';
import { formatMinorUnits } from 'src/core/money';
import { Period, periodRange } from 'src/core/date/period';
import { ActivityItem, BalanceTile, getBalanceTiles, getCategoryBreakdown, getPeriodSpend, getRecentActivity } from 'src/db/queries/home';

const PERIODS: Period[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

export default function Home() {
  const theme = useTheme();
  const { db, selfUserId } = useDatabase();
  const [period, setPeriod] = useState<Period>('MONTHLY');
  const [spend, setSpend] = useState<Awaited<ReturnType<typeof getPeriodSpend>>>([]);
  const [categories, setCategories] = useState<Awaited<ReturnType<typeof getCategoryBreakdown>>>([]);
  const [tiles, setTiles] = useState<BalanceTile[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  const range = useMemo(() => periodRange(period, new Date()), [period]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [spendResult, categoryResult, tileResult, activityResult] = await Promise.all([
        getPeriodSpend(db, selfUserId, range.startDate, range.endDate),
        getCategoryBreakdown(db, selfUserId, range.startDate, range.endDate),
        getBalanceTiles(db, selfUserId),
        getRecentActivity(db, selfUserId),
      ]);
      if (!cancelled) {
        setSpend(spendResult);
        setCategories(categoryResult);
        setTiles(tileResult);
        setActivity(activityResult);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, selfUserId, range.startDate, range.endDate]);

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <View style={styles.periodRow}>
        {PERIODS.map((p) => (
          <Pressable
            key={p}
            onPress={() => setPeriod(p)}
            style={[
              styles.periodButton,
              { backgroundColor: p === period ? theme.accentPrimary : theme.bgSecondary },
            ]}
          >
            <Text style={{ color: p === period ? theme.bgPrimary : theme.textPrimary }}>{p[0]}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Spend this period</Text>
      {spend.length === 0 ? (
        <Text style={{ color: theme.textSecondary }}>No spend recorded</Text>
      ) : (
        spend.map((s) => (
          <Text key={s.currency} style={[styles.spendTotal, { color: theme.textPrimary }]}>
            {formatMinorUnits(s.amountMinorUnits, s.currency)}
          </Text>
        ))
      )}
      {categories.map((c, i) => (
        <Text key={i} style={{ color: theme.textSecondary }}>
          {c.categoryName ?? 'Uncategorized'}: {formatMinorUnits(c.amountMinorUnits, c.currency)}
        </Text>
      ))}

      <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Balance</Text>
      {tiles.length === 0 ? (
        <Text style={{ color: theme.textSecondary }}>All settled up</Text>
      ) : (
        tiles.map((t) => (
          <View key={t.currency} style={styles.tileRow}>
            <Text style={{ color: theme.textSecondary }}>Owed to you: {formatMinorUnits(t.owedToMeMinorUnits, t.currency)}</Text>
            <Text style={{ color: theme.textSecondary }}>You owe: {formatMinorUnits(t.iOweMinorUnits, t.currency)}</Text>
            <Text style={{ color: theme.textPrimary }}>Net: {formatMinorUnits(t.netMinorUnits, t.currency)}</Text>
          </View>
        ))
      )}

      <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Recent activity</Text>
      <FlatList
        data={activity}
        keyExtractor={(item) => `${item.kind}_${item.id}`}
        renderItem={({ item }) => (
          <View style={styles.activityRow}>
            <Text style={{ color: theme.textPrimary }}>{item.description}</Text>
            <Text style={{ color: theme.textSecondary }}>{formatMinorUnits(item.amountMinorUnits, item.currency)}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  periodRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  periodButton: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 8 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', marginTop: 16, marginBottom: 8 },
  spendTotal: { fontSize: 28, fontWeight: 'bold' },
  tileRow: { gap: 2, marginBottom: 8 },
  activityRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
});
