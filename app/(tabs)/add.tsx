// Layout and navigation only (docs/plan/EXECUTE.md §5.3, task 4.5). Entry logic — payer,
// group, date, amount, line items, and wiring into the split editor — is Phase 5.

import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'src/ui/theme';

const STEPS = ['1. Details', '2. Items', '3. Split'] as const;

export default function AddExpense() {
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      {STEPS.map((step) => (
        <Text key={step} style={[styles.step, { color: theme.textPrimary }]}>
          {step}
        </Text>
      ))}
      <Text style={{ color: theme.textSecondary }}>Scan receipt and Import statement will live here (Phase 6/7).</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  step: { fontSize: 18, fontWeight: 'bold' },
});
