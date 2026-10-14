import { convertMinor, type SpendingRow } from '@owenil/core';
import type { ExchangeRate } from '@/types/db';

/**
 * Converts rows into a report currency using the user's own recorded rate
 * snapshots (never a live feed). For each row we use the latest snapshot dated
 * on/before the expense date, falling back to the earliest later snapshot.
 * Direct pairs are preferred; an inverse pair is used when only that exists.
 * Rows with no usable rate are excluded and reported back.
 */
export function convertRows(rows: SpendingRow[], target: string, rates: ExchangeRate[]): { rows: SpendingRow[]; excluded: Map<string, number>; converted: number } {
  const excluded = new Map<string, number>();
  let converted = 0;
  const out: SpendingRow[] = [];
  for (const r of rows) {
    if (r.currency === target) {
      out.push(r);
      continue;
    }
    const rate = pickRate(rates, r.currency, target, r.date);
    if (!rate) {
      excluded.set(r.currency, (excluded.get(r.currency) ?? 0) + 1);
      continue;
    }
    const c = (v: number) => convertMinor(v, r.currency, target, rate);
    out.push({
      ...r,
      currency: target,
      totalMinor: c(r.totalMinor),
      myShareMinor: c(r.myShareMinor),
      myPaidMinor: c(r.myPaidMinor),
      payers: r.payers.map((p) => ({ ...p, amountMinor: c(p.amountMinor) })),
    });
    converted++;
  }
  return { rows: out, excluded, converted };
}

function toDecimalString(n: number): string {
  return n.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

export function pickRate(rates: ExchangeRate[], from: string, to: string, date: string): string | null {
  const direct = rates.filter((x) => x.base_currency === from && x.quote_currency === to);
  const inverse = rates.filter((x) => x.base_currency === to && x.quote_currency === from);
  const choose = (list: ExchangeRate[]) => {
    const before = list.filter((x) => x.as_of <= date).sort((a, b) => b.as_of.localeCompare(a.as_of))[0];
    return before ?? list.sort((a, b) => a.as_of.localeCompare(b.as_of))[0];
  };
  const d = choose(direct);
  if (d) return String(d.rate);
  const i = choose(inverse);
  if (i) return toDecimalString(1 / Number(i.rate));
  return null;
}
