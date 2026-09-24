// Device pairing and group invites over QR (docs/plan/EXECUTE.md Phase 8.2/8.5,
// docs/architecture.md ADR-014). A camera scan is one-directional, so trust is mutual only
// after both sides have shown-and-scanned once — both devices open this same screen and do the
// same two things (show their code, scan the other's) in either order.
//
// With a groupId param (reached from the "Add member" button on app/groups/[groupId].tsx) this
// device's own QR also carries the group's identity, so the person scanning it can bootstrap
// the group locally (src/db/queries/groups.ts's createGroupSkeleton) before it has any data.
// When *this* device then scans the invitee's plain pairing code back, it adds them as a member
// of that group's CRDT doc — the invitee still has none of the group's history at this point;
// app/sync.tsx (file export/import or LAN) is what actually transfers it.
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';
import { useTheme } from 'src/ui/theme';
import { useDatabase } from 'src/ui/DatabaseContext';
import { upsertKnownPerson } from 'src/db/queries/devices';
import { createGroupSkeleton } from 'src/db/queries/groups';
import { writeToGroup } from 'src/crdt/store';
import { upsertMember } from 'src/crdt/write';
import { fromBase64, toBase64 } from 'src/platform/crypto/sodium';
import {
  GroupInvitePayload,
  PairingPayload,
  decodeScannedPayload,
  encodeGroupInvitePayload,
  encodePairingPayload,
  isGroupInvitePayload,
} from 'src/platform/transport/qr';

export default function Pair() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    groupId?: string;
    crdtDocId?: string;
    groupName?: string;
    defaultCurrency?: string;
    isPair?: string;
  }>();
  const { db, selfUserId, selfDeviceId } = useDatabase();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<'show' | 'scan'>('show');
  const [myPayload, setMyPayload] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    (async () => {
      const [self] = await db.getAllAsync<{ username: string }>('SELECT username FROM users WHERE user_id = ?', [
        selfUserId,
      ]);
      const [device] = await db.getAllAsync<{ device_name: string; public_key: Uint8Array }>(
        'SELECT device_name, public_key FROM devices WHERE device_id = ?',
        [selfDeviceId]
      );
      if (!self || !device) return;

      const base: PairingPayload = {
        v: 1,
        userId: selfUserId,
        deviceId: selfDeviceId,
        deviceName: device.device_name,
        displayName: self.username,
        publicKey: toBase64(device.public_key),
      };

      if (params.groupId && params.crdtDocId && params.groupName && params.defaultCurrency) {
        const invite: GroupInvitePayload = {
          ...base,
          groupId: params.groupId,
          crdtDocId: params.crdtDocId,
          groupName: params.groupName,
          defaultCurrency: params.defaultCurrency,
          isPair: params.isPair === '1',
        };
        setMyPayload(encodeGroupInvitePayload(invite));
      } else {
        setMyPayload(encodePairingPayload(base));
      }
    })();
  }, [db, selfUserId, selfDeviceId, params.groupId, params.crdtDocId, params.groupName, params.defaultCurrency, params.isPair]);

  const handleScanned = async (data: string) => {
    if (scanning) return;
    setScanning(true);
    setError(null);
    try {
      const payload = decodeScannedPayload(data);

      await upsertKnownPerson(db, {
        userId: payload.userId,
        displayName: payload.displayName,
        deviceId: payload.deviceId,
        deviceName: payload.deviceName,
        publicKey: fromBase64(payload.publicKey),
        createdByDeviceId: selfDeviceId,
      });

      if (isGroupInvitePayload(payload)) {
        // We scanned someone else's invite — bootstrap the group so it exists locally, ready
        // to receive its data over a sync file or LAN.
        await createGroupSkeleton(db, {
          groupId: payload.groupId,
          crdtDocId: payload.crdtDocId,
          groupName: payload.groupName,
          defaultCurrency: payload.defaultCurrency,
          isPair: payload.isPair,
          createdByDeviceId: selfDeviceId,
        });
      } else if (params.groupId && params.crdtDocId) {
        // We're the inviter, and this is the invitee scanning our code back — add them.
        await writeToGroup(db, params.crdtDocId, selfDeviceId, (doc) => {
          upsertMember(doc, {
            userId: payload.userId,
            role: 'member',
            joinedAt: new Date().toISOString(),
            deletedAt: null,
          });
        });
      }

      setStatus(`Paired with ${payload.displayName}.`);
      setMode('show');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  if (mode === 'scan') {
    if (!permission) {
      return <View style={[styles.container, { backgroundColor: theme.bgPrimary }]} />;
    }
    if (!permission.granted) {
      return (
        <View style={[styles.container, styles.center, { backgroundColor: theme.bgPrimary }]}>
          <Text style={{ color: theme.textPrimary }}>Pauti needs camera access to scan a pairing code.</Text>
          <Pressable onPress={requestPermission} style={[styles.primaryButton, { backgroundColor: theme.accentPrimary }]}>
            <Text style={{ color: theme.bgPrimary }}>Grant camera access</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.container}>
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(result) => handleScanned(result.data)}
        />
        {error && <Text style={[styles.error, { color: theme.accentSecondary }]}>{error}</Text>}
        <Pressable
          onPress={() => setMode('show')}
          style={[styles.secondaryButton, { borderColor: theme.textSecondary }]}
        >
          <Text style={{ color: theme.textPrimary }}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, styles.center, { backgroundColor: theme.bgPrimary }]}>
      <Text style={[styles.title, { color: theme.textPrimary }]}>
        {params.groupName ? `Invite to ${params.groupName}` : 'Pair a device'}
      </Text>
      <Text style={{ color: theme.textSecondary }}>Show this code to the other device, then scan theirs.</Text>
      {myPayload && <QRCode value={myPayload} size={220} />}
      {status && <Text style={{ color: theme.textPrimary }}>{status}</Text>}
      {error && <Text style={{ color: theme.accentSecondary }}>{error}</Text>}
      <Pressable onPress={() => setMode('scan')} style={[styles.primaryButton, { backgroundColor: theme.accentPrimary }]}>
        <Text style={{ color: theme.bgPrimary }}>Scan their code</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { justifyContent: 'center', alignItems: 'center', gap: 12, padding: 16 },
  camera: { flex: 1 },
  title: { fontSize: 20, fontWeight: 'bold' },
  error: { padding: 12 },
  primaryButton: { margin: 16, padding: 14, borderRadius: 8, alignItems: 'center' },
  secondaryButton: { margin: 16, padding: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
});
