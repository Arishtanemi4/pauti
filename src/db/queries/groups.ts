import { SqliteExecutor } from '../migrations/runner';
import { CurrencyAmount } from './types';

export interface GroupListItem {
  readonly groupId: string;
  readonly groupName: string;
  readonly isPair: boolean;
  readonly netPosition: CurrencyAmount[]; // self's net position, per currency
}

export interface GroupMember {
  readonly userId: string;
  readonly username: string;
  readonly role: 'owner' | 'member';
}

export interface GroupBalances {
  readonly memberNet: Record<string, number>; // per member, this group's currency only
  readonly currency: string;
}

/** Group list with the self user's net position in each group they belong to. */
export async function getGroupList(db: SqliteExecutor, selfUserId: string): Promise<GroupListItem[]> {
  const groups = await db.getAllAsync<{ group_id: string; group_name: string; is_pair: number }>(
    `SELECT g.group_id, g.group_name, g.is_pair
     FROM groups g
     JOIN group_members m ON m.group_id = g.group_id
     WHERE m.user_id = ? AND g.deleted_at IS NULL AND m.deleted_at IS NULL`,
    [selfUserId]
  );

  const result: GroupListItem[] = [];
  for (const g of groups) {
    const rows = await db.getAllAsync<{ currency: string; owedToMe: number | null; iOwe: number | null }>(
      `SELECT currency,
              SUM(CASE WHEN creditor_id = ? THEN outstanding_amount ELSE 0 END) AS owedToMe,
              SUM(CASE WHEN debtor_id = ? THEN outstanding_amount ELSE 0 END) AS iOwe
       FROM v_split_outstanding
       WHERE group_id = ? AND (creditor_id = ? OR debtor_id = ?)
       GROUP BY currency`,
      [selfUserId, selfUserId, g.group_id, selfUserId, selfUserId]
    );

    result.push({
      groupId: g.group_id,
      groupName: g.group_name,
      isPair: g.is_pair === 1,
      netPosition: rows.map((r) => ({
        currency: r.currency,
        amountMinorUnits: (r.owedToMe ?? 0) - (r.iOwe ?? 0),
      })),
    });
  }
  return result;
}

export async function getGroupMembers(db: SqliteExecutor, groupId: string): Promise<GroupMember[]> {
  return db.getAllAsync<GroupMember>(
    `SELECT u.user_id AS userId, u.username, m.role
     FROM group_members m
     JOIN users u ON u.user_id = m.user_id
     WHERE m.group_id = ? AND m.deleted_at IS NULL AND u.deleted_at IS NULL`,
    [groupId]
  );
}

/**
 * Net balance per member, for a single group's currency. A group whose transactions span
 * more than one currency returns one entry per currency — callers should not sum across
 * them.
 */
export async function getGroupBalances(db: SqliteExecutor, groupId: string): Promise<GroupBalances[]> {
  const rows = await db.getAllAsync<{ creditor_id: string; debtor_id: string; currency: string; outstanding_amount: number }>(
    `SELECT creditor_id, debtor_id, currency, outstanding_amount
     FROM v_split_outstanding
     WHERE group_id = ?`,
    [groupId]
  );

  const byCurrency = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const net = byCurrency.get(row.currency) ?? {};
    net[row.debtor_id] = (net[row.debtor_id] ?? 0) - row.outstanding_amount;
    net[row.creditor_id] = (net[row.creditor_id] ?? 0) + row.outstanding_amount;
    byCurrency.set(row.currency, net);
  }

  return Array.from(byCurrency.entries()).map(([currency, memberNet]) => ({ currency, memberNet }));
}
