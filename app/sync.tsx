// Sync entry point (docs/plan/EXECUTE.md Phase 8.3/8.4): export an encrypted sync file to a
// paired device, or import one they sent back. LAN sync (src/platform/transport/lan.ts) is
// reached from here too.
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from 'src/ui/theme';
import { useDatabase } from 'src/ui/DatabaseContext';
import { KnownDevice, listKnownDevices } from 'src/db/queries/devices';
import { GroupOption, getGroupOptions } from 'src/db/queries/add';
import { getOrCreateDeviceKeypair } from 'src/platform/crypto/deviceKeys';
import { fromBase64 } from 'src/platform/crypto/sodium';
import { buildEnvelope, importEnvelope } from 'src/platform/transport/envelope';
import { pickSyncFile, shareSyncFile, writeSyncFile } from 'src/platform/transport/file';

export default function Sync() {
  const theme = useTheme();
  const router = useRouter();
  const { db, selfUserId, selfDeviceId } = useDatabase();
  const [devices, setDevices] = useState<KnownDevice[]>([]);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [recipientDeviceId, setRecipientDeviceId] = useState<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [deviceList, groupList] = await Promise.all([listKnownDevices(db), getGroupOptions(db, selfUserId)]);
      setDevices(deviceList);
      setGroups(groupList);
    })();
  }, [db, selfUserId]);

  const toggleGroup = (groupId: string) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleExport = async () => {
    if (!recipientDeviceId || selectedGroupIds.size === 0) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const recipient = devices.find((d) => d.deviceId === recipientDeviceId);
      if (!recipient) throw new Error('Pick a device to export to.');

      // The device row already exists (onboarding creates it) — the name argument is only used
      // the first time this ever runs, so it's moot here.
      const { privateKey } = await getOrCreateDeviceKeypair(db, '');
      const crdtDocIds = groups.filter((g) => selectedGroupIds.has(g.groupId)).map((g) => g.crdtDocId);
      const envelope = await buildEnvelope(db, crdtDocIds, selfDeviceId, privateKey, recipient.publicKey);

      const fileUri = await writeSyncFile(envelope, `pauti-sync-${Date.now()}.json`);
      await shareSyncFile(fileUri);
      setStatus(`Exported ${crdtDocIds.length} group(s) for ${recipient.deviceName}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const envelope = await pickSyncFile();
      if (!envelope) return;

      const { privateKey } = await getOrCreateDeviceKeypair(db, '');
      const result = await importEnvelope(db, envelope, privateKey);
      setStatus(`Imported ${result.importedDocs} group(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.bgPrimary }]} contentContainerStyle={styles.content}>
      <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Export to a paired device</Text>
      {devices.length === 0 ? (
        <Text style={{ color: theme.textSecondary }}>No paired devices yet. Pair one first.</Text>
      ) : (
        <View style={styles.optionRow}>
          {devices.map((d) => (
            <Pressable
              key={d.deviceId}
              onPress={() => setRecipientDeviceId(d.deviceId)}
              style={[
                styles.option,
                { backgroundColor: d.deviceId === recipientDeviceId ? theme.accentPrimary : theme.bgSecondary },
              ]}
            >
              <Text style={{ color: d.deviceId === recipientDeviceId ? theme.bgPrimary : theme.textPrimary }}>
                {d.deviceName}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={[styles.label, { color: theme.textSecondary }]}>Groups to send</Text>
      <View style={styles.optionRow}>
        {groups.map((g) => (
          <Pressable
            key={g.groupId}
            onPress={() => toggleGroup(g.groupId)}
            style={[
              styles.option,
              { backgroundColor: selectedGroupIds.has(g.groupId) ? theme.accentPrimary : theme.bgSecondary },
            ]}
          >
            <Text style={{ color: selectedGroupIds.has(g.groupId) ? theme.bgPrimary : theme.textPrimary }}>
              {g.groupName}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        disabled={busy || !recipientDeviceId || selectedGroupIds.size === 0}
        onPress={handleExport}
        style={[styles.primaryButton, { backgroundColor: busy ? theme.bgSecondary : theme.accentPrimary }]}
      >
        <Text style={{ color: busy ? theme.textSecondary : theme.bgPrimary }}>Export &amp; share</Text>
      </Pressable>

      <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Import a sync file</Text>
      <Pressable
        disabled={busy}
        onPress={handleImport}
        style={[styles.secondaryButton, { borderColor: theme.textSecondary }]}
      >
        <Text style={{ color: theme.textPrimary }}>Pick a file to import</Text>
      </Pressable>

      <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>LAN</Text>
      <Pressable onPress={() => router.push('/lan')} style={[styles.secondaryButton, { borderColor: theme.textSecondary }]}>
        <Text style={{ color: theme.textPrimary }}>Sync over local network</Text>
      </Pressable>

      {status && <Text style={{ color: theme.textPrimary }}>{status}</Text>}
      {error && <Text style={{ color: theme.accentSecondary }}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', marginTop: 16 },
  label: { marginTop: 4 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  primaryButton: { marginTop: 8, padding: 14, borderRadius: 8, alignItems: 'center' },
  secondaryButton: { padding: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
});
