// First-run identity setup (docs/plan/EXECUTE.md Phase 8, docs/architecture.md ADR-014).
// Rendered by DatabaseProvider itself (not navigated to) whenever no self user exists yet —
// creates the self `users` row and this device's keypair before anything else can run.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from 'src/ui/theme';
import { useDatabase } from 'src/ui/DatabaseContext';
import { createSelfUser } from 'src/db/queries/devices';
import { getOrCreateDeviceKeypair } from 'src/platform/crypto/deviceKeys';

export default function Onboarding() {
  const theme = useTheme();
  const { db, refreshSelf } = useDatabase();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = async () => {
    const displayName = name.trim();
    if (!displayName) {
      setError('Enter a name to continue.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { deviceId } = await getOrCreateDeviceKeypair(db, `${displayName}'s device`);
      await createSelfUser(db, displayName, deviceId);
      await refreshSelf();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Text style={[styles.title, { color: theme.textPrimary }]}>Welcome to Pauti</Text>
      <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
        What should we call you? This name is shown to people you split expenses with.
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        placeholderTextColor={theme.textSecondary}
        autoFocus
        style={[styles.input, { color: theme.textPrimary, borderColor: theme.textSecondary }]}
      />
      {error && <Text style={{ color: theme.accentSecondary }}>{error}</Text>}
      <Pressable
        disabled={saving}
        onPress={handleContinue}
        style={[styles.primaryButton, { backgroundColor: saving ? theme.bgSecondary : theme.accentPrimary }]}
      >
        <Text style={{ color: saving ? theme.textSecondary : theme.bgPrimary }}>
          {saving ? 'Setting up...' : 'Get started'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: 'bold' },
  subtitle: { marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10 },
  primaryButton: { marginTop: 16, padding: 14, borderRadius: 8, alignItems: 'center' },
});
