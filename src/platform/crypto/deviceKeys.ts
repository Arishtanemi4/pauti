// The only file that may import expo-secure-store. Owns this device's X25519 identity: the
// public half lives in SQLite (devices.public_key, syncs nowhere — read by pairing/export UI),
// the private half never leaves OS-backed secure storage (Keystore/Keychain) and never touches
// SQLite, a sync file, or the network (docs/architecture.md ADR-014).

import * as SecureStore from 'expo-secure-store';
import { SqliteExecutor } from '../../db/migrations/runner';
import { newId } from '../../core/id';
import { fromBase64, generateKeypair, toBase64 } from './sodium';

const PRIVATE_KEY_STORE_KEY = 'pauti.device.privateKey';

export interface DeviceIdentity {
  deviceId: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * Returns this device's keypair, generating and persisting one on first call. Idempotent and
 * safe to call on every app start.
 *
 * Two storage systems can desync (e.g. dev fixtures insert a self `devices` row with no
 * matching secure-store entry, or the SQLite file and the Keystore/Keychain are restored from
 * different backups) — when the row exists but its private key doesn't, the row's public key is
 * rotated rather than inserting a second `is_self` row.
 */
export async function getOrCreateDeviceKeypair(db: SqliteExecutor, deviceName: string): Promise<DeviceIdentity> {
  const [existing] = await db.getAllAsync<{ device_id: string; public_key: Uint8Array }>(
    'SELECT device_id, public_key FROM devices WHERE is_self = 1'
  );
  const storedPrivateKey = await SecureStore.getItemAsync(PRIVATE_KEY_STORE_KEY);

  if (existing && storedPrivateKey) {
    return { deviceId: existing.device_id, publicKey: existing.public_key, privateKey: fromBase64(storedPrivateKey) };
  }

  const { publicKey, privateKey } = generateKeypair();
  await SecureStore.setItemAsync(PRIVATE_KEY_STORE_KEY, toBase64(privateKey));

  if (existing) {
    await db.runAsync('UPDATE devices SET public_key = ?, updated_at = datetime(\'now\') WHERE device_id = ?', [
      publicKey,
      existing.device_id,
    ]);
    return { deviceId: existing.device_id, publicKey, privateKey };
  }

  const deviceId = newId('dev');
  await db.runAsync(`INSERT INTO devices (device_id, device_name, public_key, is_self) VALUES (?, ?, ?, 1)`, [
    deviceId,
    deviceName,
    publicKey,
  ]);
  return { deviceId, publicKey, privateKey };
}
