import { SqliteExecutor } from '../migrations/runner';

// Reference-data lookups for the Add Expense screen (docs/plan/EXECUTE.md §5.3, step 1:
// payer, group, date, amount, currency, store, payment mode).

export interface GroupOption {
  readonly groupId: string;
  readonly groupName: string;
}

export interface StoreOption {
  readonly storeId: string;
  readonly storeName: string;
}

export interface PaymentModeOption {
  readonly paymentModeId: string;
  readonly paymentModeName: string;
}

export async function getGroupOptions(db: SqliteExecutor, selfUserId: string): Promise<GroupOption[]> {
  return db.getAllAsync<GroupOption>(
    `SELECT g.group_id AS groupId, g.group_name AS groupName
     FROM groups g
     JOIN group_members m ON m.group_id = g.group_id
     WHERE m.user_id = ? AND g.deleted_at IS NULL AND m.deleted_at IS NULL
     ORDER BY g.group_name`,
    [selfUserId]
  );
}

export async function getStoreOptions(db: SqliteExecutor): Promise<StoreOption[]> {
  return db.getAllAsync<StoreOption>(
    `SELECT store_id AS storeId, store_name AS storeName FROM stores WHERE deleted_at IS NULL ORDER BY store_name`
  );
}

export async function getPaymentModeOptions(db: SqliteExecutor): Promise<PaymentModeOption[]> {
  return db.getAllAsync<PaymentModeOption>(
    `SELECT payment_mode_id AS paymentModeId, payment_mode_name AS paymentModeName
     FROM payment_modes WHERE deleted_at IS NULL ORDER BY payment_mode_name`
  );
}
