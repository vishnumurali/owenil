import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  BedDouble, Briefcase, Bus, CalendarClock, Clapperboard, Fuel, GraduationCap, HeartPulse, Home, Lock, Plane, PlugZap, Repeat,
  ShoppingBag, ShoppingBasket, Sofa, Sparkles, Tag, Trash2, Utensils,
} from 'lucide-react';
import { formatMoney } from '@owenil/core';
import { cn, formatDate } from '@/lib/utils';
import type { Category, Expense } from '@/types/db';
import { useAuth } from '@/features/auth/AuthProvider';
import { useContacts, useMe } from '@/data/queries';
import { Avatar } from './ui/avatar';
import { Badge } from './ui/misc';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { ItemPayButton } from '@/features/payments/ItemPay';

const ICONS: Record<string, React.ElementType> = {
  utensils: Utensils, 'shopping-basket': ShoppingBasket, home: Home, 'plug-zap': PlugZap, plane: Plane, bus: Bus, fuel: Fuel,
  'bed-double': BedDouble, 'shopping-bag': ShoppingBag, clapperboard: Clapperboard, 'heart-pulse': HeartPulse,
  'graduation-cap': GraduationCap, repeat: Repeat, sofa: Sofa, briefcase: Briefcase, tag: Tag,
};
export const CATEGORY_ICON_NAMES = Object.keys(ICONS);

export function CategoryIcon({ category, className, size = 'md' }: { category?: Pick<Category, 'icon' | 'color'> | null; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const Icon = (category && ICONS[category.icon]) || Tag;
  const color = category?.color ?? '#94a3b8';
  const box = { sm: 'size-8 rounded-lg', md: 'size-10 rounded-xl', lg: 'size-12 rounded-2xl' }[size];
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center', box, className)} style={{ background: `${color}1f`, color }} aria-hidden>
      <Icon className={size === 'sm' ? 'size-4' : 'size-5'} />
    </span>
  );
}

export function PersonChip({ userId, size = 'xs', showYou = true, className }: { userId: string; size?: 'xs' | 'sm'; showYou?: boolean; className?: string }) {
  const { data } = useContacts();
  const { user } = useAuth();
  const p = data?.get(userId);
  const name = showYou && userId === user?.id ? 'You' : p?.display_name ?? 'Former member';
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <Avatar name={p?.display_name ?? '?'} color={p?.avatar_color} size={size} />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** One line of "you lent / you borrowed" for an expense from the viewer's perspective. */
export function myExpenseEffect(e: Expense, me: string): { label: string; amount: number; tone: 'positive' | 'negative' | 'neutral' } {
  const paid = e.expense_payers?.filter((p) => p.user_id === me).reduce((a, p) => a + Number(p.amount_minor), 0) ?? 0;
  const owed = e.expense_splits?.filter((s) => s.user_id === me).reduce((a, s) => a + Number(s.amount_minor), 0) ?? 0;
  const net = paid - owed;
  if (paid === 0 && owed === 0) return { label: 'not involved', amount: 0, tone: 'neutral' };
  if (net > 0) return { label: 'you lent', amount: net, tone: 'positive' };
  if (net < 0) return { label: 'you borrowed', amount: -net, tone: 'negative' };
  return { label: 'settled share', amount: 0, tone: 'neutral' };
}

export function ExpenseRow({ expense, categories, groupName, className }: { expense: Expense; categories?: Map<string, Category>; groupName?: string | null; className?: string }) {
  const { user } = useAuth();
  const { data: contacts } = useContacts();
  const cat = expense.category_id ? categories?.get(expense.category_id) : null;
  const effect = myExpenseEffect(expense, user?.id ?? '');
  const payers = expense.expense_payers ?? [];
  const payerText =
    payers.length > 1
      ? `${payers.length} people paid`
      : payers[0]
        ? `${payers[0].user_id === user?.id ? 'You' : contacts?.get(payers[0].user_id)?.display_name ?? 'Someone'} paid`
        : '';
  return (
    <div className={cn('group flex flex-wrap items-center rounded-xl transition-colors hover:bg-muted/60', expense.deleted_at && 'opacity-60', className)}>
    <Link
      to={`/expenses/${expense.id}`}
      className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-3 focus-visible:bg-muted/60"
    >
      <div className="hidden w-11 shrink-0 text-center sm:block">
        <p className="text-2xs font-medium uppercase text-fg-subtle">{formatDate(expense.expense_date, { month: 'short' })}</p>
        <p className="font-display text-lg font-semibold leading-tight">{formatDate(expense.expense_date, { day: 'numeric' })}</p>
      </div>
      <CategoryIcon category={cat} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate font-medium">
          <span className="truncate">{expense.description}</span>
          {expense.recurring_template_id && <CalendarClock className="size-3.5 shrink-0 text-fg-subtle" aria-label="Recurring" />}
          {expense.deleted_at && (
            <Badge tone="negative">
              <Trash2 /> Deleted
            </Badge>
          )}
          {expense.is_demo && <Badge tone="warning">Demo</Badge>}
        </p>
        <p className="truncate text-xs text-fg-muted">
          <span className="sm:hidden">{formatDate(expense.expense_date, { day: 'numeric', month: 'short' })} · </span>
          {payerText} {formatMoney(Number(expense.amount_minor), expense.currency)}
          {groupName ? ` · ${groupName}` : ''}
        </p>
      </div>
      <div className="text-right">
        <p className={cn('text-2xs', effect.tone === 'positive' ? 'text-positive' : effect.tone === 'negative' ? 'text-negative' : 'text-fg-subtle')}>{effect.label}</p>
        {effect.amount > 0 && (
          <p className={cn('tabular text-sm font-semibold', effect.tone === 'positive' ? 'text-positive' : 'text-negative')}>{formatMoney(effect.amount, expense.currency)}</p>
        )}
      </div>
    </Link>
    {/* Phones: on its own line under the expense so the name stays readable. */}
    {!expense.deleted_at && <ItemPayButton expense={expense} className="-mt-1 flex w-full justify-end px-3 pb-3 sm:mt-0 sm:w-auto sm:p-0 sm:pr-3" />}
    </div>
  );
}

/** Wraps Owenil Plus features. The real gate is server-side; this explains it. */
export function PlusGate({ children, feature, description, className }: { children?: React.ReactNode; feature: string; description?: string; className?: string }) {
  const me = useMe();
  if (me.isLoading) return null;
  if (me.data?.isPlus) return <>{children}</>;
  return (
    <Card className={cn('relative overflow-hidden p-8 text-center', className)}>
      <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,hsl(var(--plus)/0.12),transparent_70%)]" />
      <div className="relative">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-plus-soft text-plus">
          <Lock className="size-6" />
        </div>
        <h3 className="text-lg font-semibold">{feature} is part of Owenil Plus</h3>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-fg-muted">{description ?? 'Upgrade to unlock this feature.'}</p>
        <Button asChild variant="plus" className="mt-5">
          <Link to="/plus">
            <Sparkles /> See Owenil Plus
          </Link>
        </Button>
      </div>
    </Card>
  );
}

export function PlusBadge({ className }: { className?: string }) {
  return (
    <Badge tone="plus" className={className}>
      <Sparkles /> Plus
    </Badge>
  );
}

export function GroupBadge({ emoji, color, size = 'md' }: { emoji: string; color: string; size?: 'sm' | 'md' | 'lg' }) {
  const box = { sm: 'size-8 text-base rounded-lg', md: 'size-11 text-xl rounded-xl', lg: 'size-16 text-3xl rounded-2xl' }[size];
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center', box)} style={{ background: `linear-gradient(135deg, ${color}33, ${color}14)`, boxShadow: `inset 0 0 0 1px ${color}33` }} aria-hidden>
      {emoji}
    </span>
  );
}
