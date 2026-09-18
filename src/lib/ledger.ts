import type { DB } from "@op-engineering/op-sqlite";

import type { Account, Txn } from "./budget";

/**
 * Storage for the budget feature. All of the I/O, none of the arithmetic —
 * budget.ts stays pure so it can be checked without a phone, and this is the
 * only place that knows SQLite exists.
 *
 * Amounts are INTEGER centavos in the column type as well as in the language.
 * SQLite would happily hold a float here, and a balance read and written a few
 * hundred times would stop adding up.
 */
export async function createLedgerTables(db: DB): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS accounts (
       id             TEXT PRIMARY KEY,
       name           TEXT NOT NULL,
       type           TEXT NOT NULL,
       openingBalance INTEGER NOT NULL DEFAULT 0,
       archived       INTEGER NOT NULL DEFAULT 0,
       createdAt      TEXT NOT NULL
     )`
  );
  await db.execute(
    `CREATE TABLE IF NOT EXISTS txns (
       id           TEXT PRIMARY KEY,
       kind         TEXT NOT NULL,
       amount       INTEGER NOT NULL,
       accountId    TEXT NOT NULL,
       toAccountId  TEXT,
       category     TEXT,
       source       TEXT,
       note         TEXT,
       at           TEXT NOT NULL
     )`
  );
  // Every screen reads newest-first, and the month buckets are prefix scans on
  // the same column.
  await db.execute("CREATE INDEX IF NOT EXISTS txns_at ON txns (at DESC)");
  await db.execute("CREATE INDEX IF NOT EXISTS txns_account ON txns (accountId)");
}

type AccountRow = {
  id: string;
  name: string;
  type: string;
  openingBalance: number;
  archived: number;
};

export async function listAccounts(db: DB): Promise<Account[]> {
  const result = await db.execute(
    "SELECT id, name, type, openingBalance, archived FROM accounts ORDER BY createdAt ASC"
  );
  return (result.rows as unknown as AccountRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type as Account["type"],
    openingBalance: row.openingBalance,
    // SQLite has no boolean, so the column is 0/1 and the seam is here rather
    // than in every screen that reads it.
    archived: row.archived === 1,
  }));
}

export async function saveAccount(db: DB, account: Account): Promise<void> {
  await db.execute(
    `INSERT INTO accounts (id, name, type, openingBalance, archived, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name           = excluded.name,
                                   type           = excluded.type,
                                   openingBalance = excluded.openingBalance,
                                   archived       = excluded.archived`,
    [
      account.id,
      account.name,
      account.type,
      Math.round(account.openingBalance),
      account.archived ? 1 : 0,
      new Date().toISOString(),
    ]
  );
}

/** How many transactions would go with this account, for the confirm to say. */
export async function countTxns(db: DB, accountId: string): Promise<number> {
  const result = await db.execute(
    "SELECT COUNT(*) AS n FROM txns WHERE accountId = ? OR toAccountId = ?",
    [accountId, accountId]
  );
  return (result.rows[0] as { n?: number } | undefined)?.n ?? 0;
}

/**
 * Removes the account and everything recorded against it.
 *
 * Deliberately not a bare DELETE on `accounts`: a transaction pointing at an
 * account that no longer exists still counts toward the month's spending but
 * can never be shown or corrected, so the totals would disagree with the list
 * that is supposed to explain them. The screen says how many will go first.
 */
export async function deleteAccount(db: DB, accountId: string): Promise<void> {
  await db.execute("DELETE FROM txns WHERE accountId = ? OR toAccountId = ?", [
    accountId,
    accountId,
  ]);
  await db.execute("DELETE FROM accounts WHERE id = ?", [accountId]);
}

type TxnRow = {
  id: string;
  kind: string;
  amount: number;
  accountId: string;
  toAccountId: string | null;
  category: string | null;
  source: string | null;
  note: string | null;
  at: string;
};

/**
 * The ledger, newest first.
 *
 * ponytail: the whole table, bounded by `limit`, with the sums done in JS.
 * Balances need every transaction anyway, and a phone's ledger is thousands of
 * rows, not millions. When it stops being instant the upgrade is SUM() in SQL
 * grouped by account — not pagination, which would report a wrong balance.
 */
export async function listTxns(db: DB, limit = 5000): Promise<Txn[]> {
  const result = await db.execute(
    `SELECT id, kind, amount, accountId, toAccountId, category, source, note, at
     FROM txns ORDER BY at DESC LIMIT ?`,
    [limit]
  );

  return (result.rows as unknown as TxnRow[]).map((row) => ({
    id: row.id,
    kind: row.kind as Txn["kind"],
    amount: row.amount,
    accountId: row.accountId,
    ...(row.toAccountId ? { toAccountId: row.toAccountId } : {}),
    ...(row.category ? { category: row.category as Txn["category"] } : {}),
    ...(row.source ? { source: row.source as Txn["source"] } : {}),
    ...(row.note ? { note: row.note } : {}),
    at: row.at,
  }));
}

export async function saveTxn(db: DB, txn: Txn): Promise<void> {
  await db.execute(
    `INSERT INTO txns (id, kind, amount, accountId, toAccountId, category, source, note, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET kind        = excluded.kind,
                                   amount      = excluded.amount,
                                   accountId   = excluded.accountId,
                                   toAccountId = excluded.toAccountId,
                                   category    = excluded.category,
                                   source      = excluded.source,
                                   note        = excluded.note,
                                   at          = excluded.at`,
    [
      txn.id,
      txn.kind,
      // Stored positive whatever the caller passed: the kind carries direction,
      // and a negative expense would quietly behave as income everywhere.
      Math.round(Math.abs(txn.amount)),
      txn.accountId,
      txn.toAccountId ?? null,
      txn.category ?? null,
      txn.source ?? null,
      txn.note ?? null,
      txn.at,
    ]
  );
}

export async function deleteTxn(db: DB, id: string): Promise<void> {
  await db.execute("DELETE FROM txns WHERE id = ?", [id]);
}
