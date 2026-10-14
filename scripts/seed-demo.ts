/**
 * Owenil demo data — FICTIONAL people and amounts, clearly flagged is_demo.
 *
 *   npm run db:seed          create demo data (fails if it already exists)
 *   npm run db:reset-demo    wipe all demo data, then recreate it
 *   npm run db:seed -- --wipe   remove demo data only
 *
 * Demo accounts get long random passwords, written to demo-credentials.local.json
 * (gitignored). There are no shared, guessable passwords. Every financial
 * record is created through the same RPCs the app uses, signed in as each
 * demo user, so RLS and validation apply exactly as in production.
 */
import { writeFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeSplit, simplifyDebts, type ItemInput, type ParticipantInput, type SplitMethod } from '@owenil/core';
import { adminClient, createConfirmedUser, deleteAuthUsersByEmail, pgClient, purgeProfiles, randomPassword, rpcOrThrow, userClient } from './lib';

const DOMAIN = 'demo.owenil.test';
const PEOPLE = [
  { key: 'aarav', name: 'Aarav Mehta', color: '#14b8a6' },
  { key: 'diya', name: 'Diya Sharma', color: '#8b5cf6' },
  { key: 'kabir', name: 'Kabir Rao', color: '#f97316' },
  { key: 'meera', name: 'Meera Iyer', color: '#ec4899' },
  { key: 'rohan', name: 'Rohan Das', color: '#0ea5e9' },
  { key: 'zara', name: 'Zara Khan', color: '#eab308' },
] as const;
type Key = (typeof PEOPLE)[number]['key'];

const args = process.argv.slice(2);
const today = new Date();
const daysAgo = (n: number) => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);
const firstOfMonthsAgo = (n: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - n, 1)).toISOString().slice(0, 10);
let keyCounter = 0;
const idem = () => `seed-${Date.now()}-${keyCounter++}`;

async function wipe() {
  const db = await pgClient();
  try {
    await purgeProfiles(db, 'is_demo');
  } finally {
    await db.end();
  }
  const removed = await deleteAuthUsersByEmail(adminClient(), (e) => e.endsWith(`@${DOMAIN}`));
  console.log(`✓ Removed demo data (${removed} demo accounts)`);
}

interface ExpOpts {
  group?: string | null;
  description: string;
  amount: number; // minor units
  currency?: string;
  date: string;
  category: string;
  payers: [Key, number][];
  participants: (Key | { k: Key; included?: boolean; value?: number })[];
  method?: SplitMethod;
  items?: (Omit<ItemInput, 'assignees'> & { assignees: Key[] })[];
  notes?: string;
  tags?: string[];
}

async function main() {
  if (args.includes('--wipe') || args.includes('--reset')) await wipe();
  if (args.includes('--wipe')) return;

  const admin = adminClient();
  const db = await pgClient();
  const existing = await db.query('select count(*)::int as n from public.profiles where is_demo');
  if (existing.rows[0].n > 0) {
    await db.end();
    throw new Error('Demo data already exists. Run `npm run db:reset-demo` to recreate it.');
  }

  console.log('Creating six demo accounts…');
  const creds: Record<string, { email: string; password: string; name: string }> = {};
  const ids = {} as Record<Key, string>;
  for (const p of PEOPLE) {
    const email = `${p.key}@${DOMAIN}`;
    const password = randomPassword();
    ids[p.key] = await createConfirmedUser(admin, email, password, { display_name: p.name, default_currency: 'INR', timezone: 'Asia/Kolkata' });
    creds[p.key] = { email, password, name: p.name };
  }
  await db.query(
    `update public.profiles p set is_demo = true, is_tester = true, onboarded_at = now(), avatar_color = v.color
       from (select unnest($1::uuid[]) as id, unnest($2::text[]) as color) v where p.id = v.id`,
    [PEOPLE.map((p) => ids[p.key]), PEOPLE.map((p) => p.color)],
  );
  writeFileSync('demo-credentials.local.json', JSON.stringify({ warning: 'Fictional demo accounts. Local file — never commit.', accounts: creds }, null, 2));

  const c = {} as Record<Key, SupabaseClient>;
  for (const p of PEOPLE) c[p.key] = (await userClient(creds[p.key]!.email, creds[p.key]!.password)).client;
  const cats = new Map((await db.query('select slug, id from public.categories where is_system')).rows.map((r) => [r.slug as string, r.id as string]));

  const befriend = async (a: Key, b: Key) => {
    const inv = rpcOrThrow(await c[a].rpc('create_friend_invitation', { p_email: null }), 'invite') as { token: string };
    rpcOrThrow(await c[b].rpc('accept_friend_invitation', { p_token: inv.token }), 'accept');
  };
  console.log('Friendships…');
  for (const f of ['diya', 'kabir', 'meera', 'rohan', 'zara'] as Key[]) await befriend('aarav', f);
  await befriend('diya', 'meera');
  await befriend('kabir', 'meera');
  await befriend('kabir', 'rohan');

  console.log('Groups…');
  const group = async (by: Key, name: string, type: string, emoji: string, color: string, description: string, members: Key[]) =>
    rpcOrThrow(await c[by].rpc('create_group', {
      p_name: name, p_description: description, p_group_type: type, p_currency: 'INR', p_emoji: emoji, p_color: color, p_simplify: true, p_member_ids: members.map((m) => ids[m]),
    }), 'create_group') as string;
  const goa = await group('aarav', 'Goa Getaway 2026', 'travel', '🏖️', '#0ea5e9', 'Four friends, five days, too much seafood.', ['diya', 'kabir', 'meera']);
  const flat = await group('aarav', 'Flat 4B — Indiranagar', 'home', '🏠', '#14b8a6', 'Rent, bills and groceries for the flat.', ['rohan', 'zara']);
  const trek = await group('kabir', 'Kodachadri Trek', 'outing', '🏔️', '#10b981', 'Weekend trek — all settled up.', ['meera', 'rohan']);
  // Zara joins the trek through an invitation link (exercises the invite flow).
  const inv = rpcOrThrow(await c.kabir.rpc('create_group_invitation', { p_group_id: trek, p_role: 'member', p_max_uses: 5, p_valid_days: 7 }), 'group invite') as { token: string };
  rpcOrThrow(await c.zara.rpc('accept_group_invitation', { p_token: inv.token }), 'join trek');

  const payloadOf = (o: ExpOpts) => {
    const currency = o.currency ?? 'INR';
    const method = o.method ?? 'equal';
    const participants: ParticipantInput[] = o.participants.map((p) => (typeof p === 'string' ? { userId: ids[p] } : { userId: ids[p.k], included: p.included, value: p.value }));
    const items: ItemInput[] | undefined = o.items?.map((i) => ({ ...i, assignees: i.assignees.map((k) => ({ userId: ids[k] })) }));
    const allocations = computeSplit({ method, totalMinor: o.amount, participants, items });
    const allocated = new Set(allocations.map((a) => a.userId));
    return {
      group_id: o.group ?? null, description: o.description, amount_minor: o.amount, currency, expense_date: o.date,
      category_id: cats.get(o.category) ?? null, notes: o.notes ?? null, tags: o.tags ?? [], split_method: method,
      payers: o.payers.map(([k, a]) => ({ user_id: ids[k], amount_minor: a })),
      participants: participants.map((p) => ({ user_id: p.userId, included: method === 'itemized' ? allocated.has(p.userId) : p.included !== false, value: method === 'equal' || method === 'itemized' ? null : p.value ?? 0 })),
      splits: allocations.map((a) => ({ user_id: a.userId, amount_minor: a.amountMinor })),
      items: (items ?? []).map((i) => ({ name: i.name, amount_minor: i.amountMinor, kind: i.kind ?? 'item', assignees: i.assignees.map((a) => ({ user_id: a.userId, weight: 1 })) })),
      receipt_id: null,
    };
  };
  const exp = async (by: Key, o: ExpOpts) => (rpcOrThrow(await c[by].rpc('create_expense', { p_payload: payloadOf(o), p_idempotency_key: idem() }), o.description) as { expense_id: string }).expense_id;
  const settle = async (by: Key, group: string | null, from: Key, to: Key, amount: number, date: string, method = 'upi', note: string | null = null) =>
    (rpcOrThrow(await c[by].rpc('record_settlement', {
      p_payload: { group_id: group, payer_id: ids[from], payee_id: ids[to], amount_minor: amount, currency: 'INR', settled_on: date, method, note }, p_idempotency_key: idem(),
    }), 'settlement') as { settlement_id: string }).settlement_id;

  // Aarav is the premium test account (development entitlement, testers mode).
  rpcOrThrow(await c.aarav.rpc('dev_set_plan', { p_plan: 'plus' }), 'dev_set_plan');

  console.log('Expenses…');
  const ALL4: Key[] = ['aarav', 'diya', 'kabir', 'meera'];
  await exp('aarav', { group: goa, description: 'Return flights BLR ⇄ GOI', amount: 3680000, date: daysAgo(40), category: 'travel', payers: [['aarav', 3680000]], participants: ALL4, tags: ['flights'] });
  await exp('diya', { group: goa, description: 'Beach villa, 3 nights', amount: 2400000, date: daysAgo(38), category: 'accommodation', payers: [['diya', 1200000], ['kabir', 1200000]], participants: ALL4, notes: 'Diya and Kabir each paid half at check-in.' });
  const dinner = await exp('aarav', {
    group: goa, description: 'Seafood dinner at Fisherman’s Wharf', amount: 684000, date: daysAgo(37), category: 'food', method: 'itemized', payers: [['aarav', 684000]], participants: ALL4,
    items: [
      { name: 'Prawn curry', amountMinor: 145000, assignees: ['aarav', 'diya'] },
      { name: 'Fish thali ×2', amountMinor: 160000, assignees: ['kabir', 'meera'] },
      { name: 'Kingfish fry', amountMinor: 189000, assignees: ALL4 },
      { name: 'Fresh lime sodas', amountMinor: 120000, assignees: ['aarav', 'kabir'] },
      { name: 'GST', amountMinor: 35000, kind: 'tax', assignees: [] },
      { name: 'Tip', amountMinor: 35000, kind: 'tip', assignees: [] },
    ],
  });
  await exp('kabir', { group: goa, description: 'Scooter rentals', amount: 320000, date: daysAgo(37), category: 'transport', method: 'shares', payers: [['kabir', 320000]],
    participants: [{ k: 'aarav', value: 100 }, { k: 'diya', value: 100 }, { k: 'kabir', value: 200 }, { k: 'meera', included: false }], notes: 'Kabir took two days, Meera didn’t ride.' });
  await exp('aarav', { group: goa, description: 'Scuba diving (booked online)', amount: 12000, currency: 'USD', date: daysAgo(36), category: 'entertainment', method: 'exact', payers: [['aarav', 12000]],
    participants: [{ k: 'aarav', value: 6000 }, { k: 'kabir', value: 6000 }, { k: 'diya', included: false }, { k: 'meera', included: false }] });
  await exp('meera', { group: goa, description: 'Groceries & snacks', amount: 184600, date: daysAgo(36), category: 'groceries', method: 'percentage', payers: [['meera', 184600]],
    participants: [{ k: 'aarav', value: 4000 }, { k: 'diya', value: 2000 }, { k: 'kabir', value: 2000 }, { k: 'meera', value: 2000 }] });
  await exp('kabir', { group: goa, description: 'Taxi to the airport', amount: 240000, date: daysAgo(35), category: 'transport', method: 'adjustment', payers: [['kabir', 240000]],
    participants: [{ k: 'aarav', value: 0 }, { k: 'diya', value: 0 }, { k: 'kabir', value: 0 }, { k: 'meera', value: 40000 }], notes: 'Extra stop for Meera.' });
  await exp('diya', { group: goa, description: 'Club entry', amount: 400000, date: daysAgo(36), category: 'entertainment', payers: [['diya', 400000]], participants: ALL4 });

  const FLAT: Key[] = ['aarav', 'rohan', 'zara'];
  await exp('rohan', { group: flat, description: 'Electricity (BESCOM)', amount: 346000, date: daysAgo(20), category: 'utilities', payers: [['rohan', 346000]], participants: FLAT });
  await exp('zara', { group: flat, description: 'Wi-Fi', amount: 118000, date: daysAgo(18), category: 'utilities', payers: [['zara', 118000]], participants: FLAT, notes: '₹1,180 ÷ 3 — one paisa goes to a fixed person so the total stays exact.' });
  await exp('aarav', { group: flat, description: 'BigBasket order', amount: 421550, date: daysAgo(9), category: 'groceries', payers: [['aarav', 421550]], participants: FLAT });
  await exp('zara', { group: flat, description: 'Cleaning supplies', amount: 89000, date: daysAgo(6), category: 'household', payers: [['zara', 89000]], participants: FLAT });
  await exp('rohan', { group: flat, description: 'Gas cylinder refill', amount: 110500, date: daysAgo(3), category: 'household', payers: [['rohan', 110500]], participants: FLAT });

  const TREK: Key[] = ['kabir', 'meera', 'rohan', 'zara'];
  await exp('kabir', { group: trek, description: 'KSRTC bus tickets', amount: 360000, date: daysAgo(28), category: 'transport', payers: [['kabir', 360000]], participants: TREK });
  await exp('rohan', { group: trek, description: 'Homestay', amount: 600000, date: daysAgo(27), category: 'accommodation', payers: [['rohan', 600000]], participants: TREK });
  await exp('meera', { group: trek, description: 'Trek guide', amount: 200000, date: daysAgo(27), category: 'travel', payers: [['meera', 200000]], participants: TREK });
  await exp('zara', { group: trek, description: 'Meals on the trail', amount: 278000, date: daysAgo(26), category: 'food', payers: [['zara', 278000]], participants: TREK });

  await exp('diya', { description: 'Movie night', amount: 98000, date: daysAgo(12), category: 'entertainment', payers: [['diya', 98000]], participants: ['aarav', 'diya'] });
  await exp('aarav', { description: 'Gift for Priya’s wedding', amount: 350000, date: daysAgo(15), category: 'shopping', method: 'exact', payers: [['aarav', 350000]],
    participants: [{ k: 'aarav', value: 175000 }, { k: 'diya', value: 175000 }] });
  await exp('kabir', { description: 'IPL match tickets', amount: 240000, date: daysAgo(22), category: 'entertainment', payers: [['kabir', 240000]], participants: ['aarav', 'kabir'] });
  await exp('aarav', { description: 'Book: “The Ministry of Utmost Happiness”', amount: 59900, date: daysAgo(5), category: 'education', method: 'exact', payers: [['aarav', 59900]],
    participants: [{ k: 'aarav', value: 0 }, { k: 'meera', value: 59900 }] });

  console.log('Recurring expenses…');
  const rentPayload = payloadOf({ group: flat, description: 'Monthly rent', amount: 5400000, date: firstOfMonthsAgo(2), category: 'rent', method: 'shares', payers: [['aarav', 5400000]],
    participants: [{ k: 'aarav', value: 150 }, { k: 'rohan', value: 100 }, { k: 'zara', value: 100 }] });
  rpcOrThrow(await c.aarav.rpc('create_recurring_template', { p_payload: rentPayload, p_frequency: 'monthly', p_start_date: firstOfMonthsAgo(2), p_end_date: null }), 'rent');
  const netflix = payloadOf({ description: 'Netflix Premium', amount: 64900, date: daysAgo(70), category: 'subscriptions', payers: [['aarav', 64900]], participants: ['aarav', 'diya'] });
  rpcOrThrow(await c.aarav.rpc('create_recurring_template', { p_payload: netflix, p_frequency: 'monthly', p_start_date: daysAgo(70), p_end_date: null }), 'netflix');

  console.log('Repayments…');
  await settle('meera', goa, 'meera', 'aarav', 500000, daysAgo(30), 'upi', 'Part payment for flights');
  await settle('diya', goa, 'diya', 'kabir', 100000, daysAgo(29), 'cash');
  await settle('zara', flat, 'zara', 'aarav', 120000, daysAgo(8), 'upi');
  await settle('rohan', flat, 'rohan', 'aarav', 200000, daysAgo(4), 'bank_transfer');
  await settle('aarav', null, 'aarav', 'kabir', 120000, daysAgo(20), 'upi', 'IPL tickets');
  const bounced = await settle('diya', null, 'diya', 'aarav', 50000, daysAgo(10), 'upi', 'Movie + gift');
  rpcOrThrow(await c.aarav.rpc('reverse_settlement', { p_settlement_id: bounced, p_reason: 'UPI transfer failed' }), 'reverse');
  // Settle the trek completely using the simplified suggestions.
  const trekNets = rpcOrThrow(await c.kabir.rpc('get_group_balances', { p_group_id: trek }), 'nets') as { user_id: string; net_minor: number }[];
  const byId = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k as Key]));
  for (const t of simplifyDebts(Object.fromEntries(trekNets.map((n) => [n.user_id, Number(n.net_minor)])))) {
    await settle(byId[t.fromUserId]!, trek, byId[t.fromUserId]!, byId[t.toUserId]!, t.amountMinor, daysAgo(24), 'upi', 'Trek settle-up');
  }

  console.log('Comments, budgets & rates…');
  await c.diya.from('comments').insert({ expense_id: dinner, author_id: ids.diya, body: 'Best prawns of the trip 🦐' });
  await c.kabir.from('comments').insert({ expense_id: dinner, author_id: ids.kabir, body: 'Itemised so nobody pays for my second lime soda 😄' });
  await c.aarav.from('budgets').insert([
    { user_id: ids.aarav, name: 'Eating out', category_id: cats.get('food'), amount_minor: 800000, currency: 'INR', period: 'monthly', alert_threshold_pct: 80 },
    { user_id: ids.aarav, name: 'Travel this year', category_id: cats.get('travel'), amount_minor: 6000000, currency: 'INR', period: 'yearly', alert_threshold_pct: 75 },
  ]);
  await c.aarav.from('exchange_rate_snapshots').insert({ user_id: ids.aarav, base_currency: 'USD', quote_currency: 'INR', rate: '83.40', as_of: daysAgo(36), note: 'Card statement rate' });

  // Flag everything created by demo users as demo data.
  const demoIds = Object.values(ids);
  await db.query('update public.groups set is_demo = true where created_by = any($1::uuid[])', [demoIds]);
  await db.query('update public.expenses set is_demo = true where created_by = any($1::uuid[])', [demoIds]);
  await db.query('update public.settlements set is_demo = true where created_by = any($1::uuid[])', [demoIds]);
  await db.query('update public.recurring_expense_templates set is_demo = true where created_by = any($1::uuid[])', [demoIds]);
  const counts = await db.query(`select (select count(*) from public.expenses where is_demo)::int as expenses,
                                        (select count(*) from public.settlements where is_demo)::int as settlements,
                                        (select count(*) from public.groups where is_demo)::int as groups`);
  await db.end();
  console.log(`\n✓ Demo data ready: ${counts.rows[0].groups} groups, ${counts.rows[0].expenses} expenses, ${counts.rows[0].settlements} repayments.`);
  console.log('  Logins (random passwords) are in demo-credentials.local.json — e.g. aarav@demo.owenil.test (Owenil Plus).');
}

main().catch((e) => {
  console.error(`\n✖ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
