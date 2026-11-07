interface ReceiptDatabase {
  run(sql: string): unknown;
  query(sql: string): { run(...values: (string | number)[]): unknown; get(...values: (string | number)[]): unknown };
}

export function createPaymentReceiptStore(db: ReceiptDatabase) {
  db.run(`CREATE TABLE IF NOT EXISTS solana_payment_receipts (
    payment_id TEXT PRIMARY KEY, code TEXT NOT NULL, expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL, activated INTEGER NOT NULL DEFAULT 0
  )`);
  const insert = db.query('INSERT INTO solana_payment_receipts (payment_id, code, expires_at, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(payment_id) DO NOTHING');
  const select = db.query('SELECT code, expires_at FROM solana_payment_receipts WHERE payment_id = ?1');
  const activate = db.query('UPDATE solana_payment_receipts SET activated = 1 WHERE payment_id = ?1');
  return {
    record(paymentId: string, code: string, expiresAt: number): number {
      if (!paymentId || !code || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) throw new Error('Invalid payment receipt');
      insert.run(paymentId, code, expiresAt, Date.now());
      const row = select.get(paymentId) as { code: string; expires_at: number } | undefined;
      if (!row || row.code !== code) throw new Error('Payment receipt does not match the session');
      return row.expires_at;
    },
    markActivated(paymentId: string) { activate.run(paymentId); },
  };
}
