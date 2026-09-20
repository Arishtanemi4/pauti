import { SqliteExecutor } from '../migrations/runner';

// Data for the split editor (docs/plan/EXECUTE.md §5.5): the transaction, its line items,
// and the splits already recorded against it (header-scope and line-scope).

export interface SplitEditorLine {
  readonly lineId: string;
  readonly lineNo: number;
  readonly productName: string;
  readonly lineAmountMinorUnits: number;
}

export interface SplitEditorSplit {
  readonly splitId: string;
  readonly lineId: string | null; // null = header-scope (the unitemized remainder)
  readonly debtorId: string;
  readonly owedAmountMinorUnits: number;
  readonly splitMode: 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES';
  readonly weightNum: number;
  readonly weightDen: number;
}

export interface SplitEditorData {
  readonly trxnId: string;
  readonly totalAmountMinorUnits: number;
  readonly currency: string;
  readonly lines: SplitEditorLine[];
  readonly splits: SplitEditorSplit[];
}

export async function getSplitEditorData(db: SqliteExecutor, trxnId: string): Promise<SplitEditorData | undefined> {
  const [header] = await db.getAllAsync<{ trxn_id: string; total_amount: number; currency: string }>(
    `SELECT trxn_id, total_amount, currency FROM transaction_header WHERE trxn_id = ? AND deleted_at IS NULL`,
    [trxnId]
  );
  if (!header) return undefined;

  const lines = await db.getAllAsync<SplitEditorLine>(
    `SELECT line_id AS lineId, line_no AS lineNo, product_name AS productName, line_amount AS lineAmountMinorUnits
     FROM transaction_lines WHERE trxn_id = ? AND deleted_at IS NULL ORDER BY line_no`,
    [trxnId]
  );

  const splits = await db.getAllAsync<SplitEditorSplit>(
    `SELECT split_id AS splitId, line_id AS lineId, debtor_id AS debtorId, owed_amount AS owedAmountMinorUnits,
            split_mode AS splitMode, weight_num AS weightNum, weight_den AS weightDen
     FROM expense_splits WHERE trxn_id = ? AND deleted_at IS NULL`,
    [trxnId]
  );

  return {
    trxnId: header.trxn_id,
    totalAmountMinorUnits: header.total_amount,
    currency: header.currency,
    lines,
    splits,
  };
}
