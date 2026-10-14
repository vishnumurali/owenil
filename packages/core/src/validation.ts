import { z } from 'zod';
import { isSupportedCurrency } from './currency';
import { MAX_AMOUNT_MINOR } from './money';
import { SPLIT_METHODS } from './split';

/**
 * Validation schemas shared by web and mobile. The database re-validates
 * every financial mutation inside its RPC functions; these schemas exist for
 * fast, friendly client-side feedback and to build well-formed payloads.
 */
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date');
const minor = z.number().int().nonnegative().max(MAX_AMOUNT_MINOR);
const positiveMinor = z.number().int().positive('Amount must be greater than zero').max(MAX_AMOUNT_MINOR, 'Amount is too large');
export const currencyCode = z.string().length(3).refine(isSupportedCurrency, 'Unsupported currency');

export const CATEGORY_SLUGS = [
  'food', 'groceries', 'rent', 'utilities', 'travel', 'transport', 'fuel', 'accommodation',
  'shopping', 'entertainment', 'healthcare', 'education', 'subscriptions', 'household', 'business', 'other',
] as const;

export const GROUP_TYPES = ['travel', 'home', 'couple', 'family', 'outing', 'other'] as const;
export type GroupType = (typeof GROUP_TYPES)[number];
export const GROUP_TYPE_LABELS: Record<GroupType, string> = {
  travel: 'Trip',
  home: 'Roommates',
  couple: 'Couple',
  family: 'Family',
  outing: 'Outing',
  other: 'Other',
};

export const expensePayloadSchema = z
  .object({
    group_id: uuid.nullable(),
    description: z.string().trim().min(1, 'Add a description').max(140),
    amount_minor: positiveMinor,
    currency: currencyCode,
    expense_date: isoDate,
    category_id: uuid.nullable(),
    notes: z.string().max(2000).nullable(),
    tags: z.array(z.string().trim().min(1).max(30)).max(10),
    split_method: z.enum(SPLIT_METHODS as unknown as [string, ...string[]]),
    payers: z.array(z.object({ user_id: uuid, amount_minor: positiveMinor })).min(1, 'Choose who paid').max(50),
    participants: z
      .array(z.object({ user_id: uuid, included: z.boolean(), value: z.number().int().nullable() }))
      .min(1)
      .max(50),
    splits: z.array(z.object({ user_id: uuid, amount_minor: minor })).min(1).max(50),
    items: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(120),
          amount_minor: minor,
          kind: z.enum(['item', 'tax', 'tip', 'discount']),
          assignees: z.array(z.object({ user_id: uuid, weight: z.number().int().positive() })),
        }),
      )
      .max(200),
    receipt_id: uuid.nullable(),
  })
  .superRefine((v, ctx) => {
    const paid = v.payers.reduce((a, p) => a + p.amount_minor, 0);
    if (paid !== v.amount_minor) ctx.addIssue({ code: 'custom', path: ['payers'], message: 'Payer amounts must add up to the total' });
    const owed = v.splits.reduce((a, s) => a + s.amount_minor, 0);
    if (owed !== v.amount_minor) ctx.addIssue({ code: 'custom', path: ['splits'], message: 'Shares must add up to the total' });
  });

export type ExpensePayload = z.infer<typeof expensePayloadSchema>;

export const settlementPayloadSchema = z
  .object({
    group_id: uuid.nullable(),
    payer_id: uuid,
    payee_id: uuid,
    amount_minor: positiveMinor,
    currency: currencyCode,
    settled_on: isoDate,
    method: z.enum(['cash', 'upi', 'bank_transfer', 'card', 'other']),
    note: z.string().max(500).nullable(),
    /** Optional: the expense this repayment is for (marks that expense "Paid"). */
    expense_id: uuid.nullable().optional(),
  })
  .refine((v) => v.payer_id !== v.payee_id, { message: 'Payer and recipient must be different people', path: ['payee_id'] });

export type SettlementPayload = z.infer<typeof settlementPayloadSchema>;

export const groupFormSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(60),
  description: z.string().trim().max(280).optional().default(''),
  group_type: z.enum(GROUP_TYPES),
  default_currency: currencyCode,
  emoji: z.string().max(8).optional().default('✨'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default('#14b8a6'),
  simplify_debts: z.boolean().default(true),
});
export type GroupForm = z.infer<typeof groupFormSchema>;

export const profileFormSchema = z.object({
  display_name: z.string().trim().min(1, 'Enter your name').max(60),
  default_currency: currencyCode,
  timezone: z.string().min(1).max(64),
});

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(72, 'Use at most 72 characters')
  .regex(/[a-zA-Z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');

export const budgetFormSchema = z.object({
  category_id: uuid.nullable(),
  group_id: uuid.nullable(),
  amount_minor: positiveMinor,
  currency: currencyCode,
  period: z.enum(['monthly', 'yearly']),
  alert_threshold_pct: z.number().int().min(1).max(100),
});

export const exchangeRateSchema = z.object({
  base_currency: currencyCode,
  quote_currency: currencyCode,
  rate: z.string().regex(/^\d{1,9}(\.\d{1,10})?$/, 'Enter a positive decimal rate').refine((r) => Number(r) > 0, 'Rate must be greater than zero'),
  as_of: isoDate,
}).refine((v) => v.base_currency !== v.quote_currency, { message: 'Choose two different currencies', path: ['quote_currency'] });
