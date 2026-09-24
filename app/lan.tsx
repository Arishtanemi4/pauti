// LAN sync (docs/plan/EXECUTE.md Phase 8.4, docs/architecture.md ADR-014): sync over the local
// network with a paired device, both on the same Wi-Fi. Manual IP entry, not mDNS — one device
// starts listening and shows its IP, the other types it in and connects; the handshake itself
// (src/platform/transport/lan.ts) is symmetric, so it doesn't matter which side does which.
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from 'src/ui/theme';
import { useDatabase } from 'src/ui/DatabaseContext';
import { KnownDevice, listKnownDevices } from 'src/db/queries/devices';
import { getOrCreateDeviceKeypair } from 'src/platform/crypto/deviceKeys';
import { connectToPeer, getLocalIpAddress, startLanServer } from 'src/platform/transport/lan';

export default function Lan() {
  const theme = useTheme();
  const { db, selfDeviceId } = useDatabase();
  const [devices, setDevices] = useState<KnownDevice[]>([]);
  const [peerDeviceId, setPeerDeviceId] = useState<string | null>(null);
  const [peerIp, setPeerIp] = useState('');
  const [myIp, setMyIp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listKnownDevices(db).then(setDevices);
    getLocalIpAddress().then(setMyIp).catch(() => setMyIp(null));
  }, [db]);

  const run = async (sync: (params: {
    db: typeof db;
    myDeviceId: string;
    myPrivateKey: Uint8Array;
    peerPublicKey: Uint8Array;
    onStatus: (s: string) => void;
  }) => Promise<void>) => {
    if (!peerDeviceId) return;
    const peer = devices.find((d) => d.deviceId === peerDeviceId);
    if (!peer) return;

    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const { privateKey } = await getOrCreateDeviceKeypair(db, '');
      await sync({
        db,
        myDeviceId: selfDeviceId,
        myPrivateKey: privateKey,
        peerPublicKey: peer.publicKey,
        onStatus: setStatus,
      });
      setStatus(`Synced with ${peer.deviceName}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleListen = () => run((params) => startLanServer({ ...params, peerDeviceId: peerDeviceId! }));
  const handleConnect = () => run((params) => connectToPeer(peerIp, params));

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Peer device</Text>
      {devices.length === 0 ? (
        <Text style={{ color: theme.textSecondary }}>No paired devices yet. Pair one first.</Text>
      ) : (
        <View style={styles.optionRow}>
          {devices.map((d) => (
            <Pressable
              key={d.deviceId}
              onPress={() => setPeerDeviceId(d.deviceId)}
              style={[
                styles.option,
                { backgroundColor: d.deviceId === peerDeviceId ? theme.accentPrimary : theme.bgSecondary },
              ]}
            >
              <Text style={{ color: d.deviceId === peerDeviceId ? theme.bgPrimary : theme.textPrimary }}>
                {d.deviceName}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Listen for a connection</Text>
      <Text style={{ color: theme.textSecondary }}>Your IP: {myIp ?? '...'}</Text>
      <Pressable
        disabled={busy || !peerDeviceId}
        onPress={handleListen}
        style={[styles.primaryButton, { backgroundColor: busy ? theme.bgSecondary : theme.accentPrimary }]}
      >
        <Text style={{ color: busy ? theme.textSecondary : theme.bgPrimary }}>Start listening</Text>
      </Pressable>

      <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Connect to their IP</Text>
      <TextInput
        value={peerIp}
        onChangeText={setPeerIp}
        placeholder="192.168.1.23"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        style={[styles.input, { color: theme.textPrimary, borderColor: theme.textSecondary }]}
      />
      <Pressable
        disabled={busy || !peerDeviceId || !peerIp}
        onPress={handleConnect}
        style={[styles.secondaryButton, { borderColor: theme.textSecondary }]}
      >
        <Text style={{ color: theme.textPrimary }}>Connect</Text>
      </Pressable>

      {status && <Text style={{ color: theme.textPrimary }}>{status}</Text>}
      {error && <Text style={{ color: theme.accentSecondary }}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', marginTop: 16 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  primaryButton: { marginTop: 8, padding: 14, borderRadius: 8, alignItems: 'center' },
  secondaryButton: { padding: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: 8, padding: 10 },
});
