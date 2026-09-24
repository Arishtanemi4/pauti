import { SqliteExecutor } from '../migrations/runner';
import { newId } from '../../core/id';

export interface KnownDevice {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly publicKey: Uint8Array;
}

/** First-run onboarding (docs/architecture.md ADR-014): creates the self user row. Callers
 *  check DatabaseContext's selfUserId is empty before rendering the screen that calls this. */
export async function createSelfUser(db: SqliteExecutor, displayName: string, deviceId: string): Promise<string> {
  const userId = newId('usr');
  await db.runAsync(`INSERT INTO users (user_id, username, is_self, created_by_device_id) VALUES (?, ?, 1, ?)`, [
    userId,
    displayName,
    deviceId,
  ]);
  return userId;
}

/** Devices already paired with, for the export-file and LAN-sync recipient pickers. */
export async function listKnownDevices(db: SqliteExecutor): Promise<KnownDevice[]> {
  return db.getAllAsync<KnownDevice>(
    `SELECT device_id AS deviceId, device_name AS deviceName, public_key AS publicKey
     FROM devices WHERE is_self = 0 ORDER BY device_name`
  );
}

/**
 * Records trust in someone met via a QR pairing or invite scan (src/platform/transport/qr.ts):
 * their device's public key, and — the first time this device has seen that person — a minimal
 * users + contacts row. Nothing here touches a shared CRDT doc; group membership is a separate
 * write (src/crdt/write.ts's upsertMember) once pairing has revealed a userId at all.
 */
export async function upsertKnownPerson(
  db: SqliteExecutor,
  params: {
    userId: string;
    displayName: string;
    deviceId: string;
    deviceName: string;
    publicKey: Uint8Array;
    createdByDeviceId: string;
  }
): Promise<void> {
  const { userId, displayName, deviceId, deviceName, publicKey, createdByDeviceId } = params;

  await db.runAsync(
    `INSERT INTO devices (device_id, device_name, public_key, is_self) VALUES (?, ?, ?, 0)
     ON CONFLICT(device_id) DO UPDATE SET device_name = excluded.device_name, public_key = excluded.public_key,
       updated_at = datetime('now')`,
    [deviceId, deviceName, publicKey]
  );

  await db.runAsync(
    `INSERT INTO users (user_id, username, is_self, created_by_device_id) VALUES (?, ?, 0, ?)
     ON CONFLICT(user_id) DO NOTHING`,
    [userId, displayName, createdByDeviceId]
  );

  const [existingContact] = await db.getAllAsync<{ contact_id: string }>(
    'SELECT contact_id FROM contacts WHERE user_id = ? AND deleted_at IS NULL',
    [userId]
  );
  if (!existingContact) {
    await db.runAsync(
      `INSERT INTO contacts (contact_id, user_id, display_name, device_id) VALUES (?, ?, ?, ?)`,
      [newId('cnt'), userId, displayName, deviceId]
    );
  }
}
