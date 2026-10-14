/**
 * Debt simplification.
 *
 * Given each member's net position in ONE currency (positive = is owed),
 * produce a short list of suggested transfers that settles everyone. The
 * greedy strategy (largest debtor pays largest creditor) needs at most n−1
 * transfers and preserves every person's net position exactly.
 *
 * Suggestions are not payments. Nothing is recorded until a user explicitly
 * records a settlement.
 */
export interface Transfer {
  fromUserId: string;
  toUserId: string;
  amountMinor: number;
}

export function simplifyDebts(nets: ReadonlyMap<string, number> | Record<string, number>): Transfer[] {
  const entries = nets instanceof Map ? [...nets.entries()] : Object.entries(nets);
  let sum = 0;
  for (const [, v] of entries) {
    if (!Number.isSafeInteger(v)) throw new Error('Net balances must be integers');
    sum += v;
  }
  if (sum !== 0) throw new Error(`Net balances must sum to zero (got ${sum})`);

  const creditors = entries.filter(([, v]) => v > 0).map(([id, v]) => ({ id, left: v }));
  const debtors = entries.filter(([, v]) => v < 0).map(([id, v]) => ({ id, left: -v }));
  const order = (a: { id: string; left: number }, b: { id: string; left: number }) =>
    b.left - a.left || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const transfers: Transfer[] = [];
  while (creditors.length && debtors.length) {
    creditors.sort(order);
    debtors.sort(order);
    const c = creditors[0]!;
    const d = debtors[0]!;
    const amount = Math.min(c.left, d.left);
    transfers.push({ fromUserId: d.id, toUserId: c.id, amountMinor: amount });
    c.left -= amount;
    d.left -= amount;
    if (c.left === 0) creditors.shift();
    if (d.left === 0) debtors.shift();
  }
  return transfers;
}

/** Apply transfers to nets — used to prove simplification preserves positions (everyone ends at zero). */
export function applyTransfers(nets: Record<string, number>, transfers: Transfer[]): Record<string, number> {
  const out = { ...nets };
  for (const t of transfers) {
    out[t.fromUserId] = (out[t.fromUserId] ?? 0) + t.amountMinor;
    out[t.toUserId] = (out[t.toUserId] ?? 0) - t.amountMinor;
  }
  return out;
}
