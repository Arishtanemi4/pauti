import { describe, expect, it, beforeEach } from 'vitest';
import { SqliteExecutor, runMigrations } from '../migrations/runner';
import { migrations } from '../migrations';
import { createNodeSqliteExecutor } from '../testing/nodeSqliteExecutor';
import { createSelfUser, listKnownDevices, upsertKnownPerson } from './devices';

let db: SqliteExecutor;

beforeEach(async () => {
  db = createNodeSqliteExecutor();
  await runMigrations(db, migrations);
  await db.runAsync(`INSERT INTO devices (device_id, device_name, public_key, is_self) VALUES ('dev_self', 'My phone', ?, 1)`, [
    new Uint8Array([1, 2, 3]),
  ]);
});

describe('createSelfUser', () => {
  it('inserts a self user row', async () => {
    const userId = await createSelfUser(db, 'Alice', 'dev_self');
    const [row] = await db.getAllAsync<{ username: string; is_self: number }>(
      'SELECT username, is_self FROM users WHERE user_id = ?',
      [userId]
    );
    expect(row).toEqual({ username: 'Alice', is_self: 1 });
  });
});

describe('upsertKnownPerson', () => {
  const bob = {
    userId: 'usr_bob',
    displayName: 'Bob',
    deviceId: 'dev_bob',
    deviceName: "Bob's phone",
    publicKey: new Uint8Array([9, 9, 9]),
    createdByDeviceId: 'dev_self',
  };

  it('creates the device, user and contact rows on first pairing', async () => {
    await upsertKnownPerson(db, bob);

    const devices = await listKnownDevices(db);
    expect(devices).toEqual([{ deviceId: 'dev_bob', deviceName: "Bob's phone", publicKey: new Uint8Array([9, 9, 9]) }]);

    const [user] = await db.getAllAsync<{ username: string }>('SELECT username FROM users WHERE user_id = ?', [
      bob.userId,
    ]);
    expect(user.username).toBe('Bob');

    const contacts = await db.getAllAsync('SELECT * FROM contacts WHERE user_id = ?', [bob.userId]);
    expect(contacts).toHaveLength(1);
  });

  it('is idempotent — re-pairing the same person twice does not duplicate rows', async () => {
    await upsertKnownPerson(db, bob);
    await upsertKnownPerson(db, { ...bob, deviceName: 'Renamed phone' });

    const devices = await listKnownDevices(db);
    expect(devices).toHaveLength(1);
    expect(devices[0].deviceName).toBe('Renamed phone');

    const contacts = await db.getAllAsync('SELECT * FROM contacts WHERE user_id = ?', [bob.userId]);
    expect(contacts).toHaveLength(1);
  });
});
