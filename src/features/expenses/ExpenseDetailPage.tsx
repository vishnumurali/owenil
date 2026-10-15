import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock, Copy, FileText, History, MessageSquare, Pencil, RotateCcw, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatMoney, SPLIT_METHOD_LABELS } from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { errorMessage, unwrap } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { formatDate, formatRelative } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { invalidateFinancial, qk, useCategories, useComments, useContacts, useExpense, useExpenseRevisions, useGroups, useNameOf } from '@/data/queries';
import type { ReceiptMeta } from '@/types/db';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { Badge, Skeleton } from '@/components/ui/misc';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, SectionTitle } from '@/components/ui/layout-bits';
import { CategoryIcon, GroupBadge } from '@/components/domain';
import { receiptUrl } from './receipts';
import { ItemPayStatus } from '@/features/payments/ItemPay';

export default function ExpenseDetailPage() {
  const { expenseId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const me = user!.id;
  const expense = useExpense(expenseId);
  const categories = useCategories();
  const groups = useGroups();
  const contacts = useContacts();
  const nameOf = useNameOf();
  const revisions = useExpenseRevisions(expenseId);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  useDocumentTitle(expense.data?.description ?? 'Expense');

  const receipt = useQuery({
    queryKey: ['receipt', expense.data?.receipt_id],
    enabled: !!expense.data?.receipt_id,
    queryFn: async () => {
      const r = unwrap(await supabase.from('receipt_metadata').select('*').eq('id', expense.data!.receipt_id!).maybeSingle()) as ReceiptMeta | null;
      return { meta: r, url: r?.storage_path ? await receiptUrl(r.storage_path) : null };
    },
  });

  if (expense.isLoading) return <div className="space-y-4"><Skeleton className="h-48 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;
  if (expense.isError) return <ErrorState error={expense.error} onRetry={() => expense.refetch()} />;
  const e = expense.data;
  if (!e) return <Card><EmptyState illustration="expenses" title="Expense not found" description="It may belong to a group you’ve left, or the link is wrong." action={<Button asChild variant="outline"><Link to="/expenses">All expenses</Link></Button>} /></Card>;

  const cat = categories.data?.find((c) => c.id === e.category_id);
  const group = groups.data?.find((g) => g.id === e.group_id);
  const payers = e.expense_payers ?? [];
  const splits = e.expense_splits ?? [];
  const parts = e.expense_participants ?? [];
  const people = [...new Set([...payers.map((p) => p.user_id), ...splits.map((s) => s.user_id), ...parts.map((p) => p.user_id)])];
  const deleted = !!e.deleted_at;

  const act = async (fn: 'delete_expense' | 'restore_expense') => {
    setBusy(true);
    try {
      unwrap(await supabase.rpc(fn, fn === 'delete_expense' ? { p_expense_id: e.id, p_expected_version: e.version } : { p_expense_id: e.id }));
      toast.success(fn === 'delete_expense' ? 'Expense deleted — balances updated' : 'Expense restored');
      invalidateFinancial(qc);
      void qc.invalidateQueries({ queryKey: ['expense-revisions'] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="space-y-6">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Back
      </button>
      {deleted && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-negative/30 bg-negative-soft p-4 text-sm text-negative">
          <Trash2 className="size-4" />
          <span className="flex-1">Deleted by {nameOf(e.deleted_by)} {formatRelative(e.deleted_at!)}. It no longer affects balances.</span>
          <Button size="sm" variant="outline" onClick={() => act('restore_expense')} loading={busy}><RotateCcw /> Restore</Button>
        </div>
      )}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
          <CategoryIcon category={cat} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{e.description}</h1>
              {e.recurring_template_id && <Badge tone="accent"><CalendarClock /> Recurring</Badge>}
              {e.is_demo && <Badge tone="warning">Demo data</Badge>}
            </div>
            <p className="mt-1 font-display text-3xl font-semibold tabular">{formatMoney(Number(e.amount_minor), e.currency)}</p>
            <p className="mt-1 text-sm text-fg-muted">
              {formatDate(e.expense_date, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })} · {cat?.name ?? 'Uncategorised'} · {SPLIT_METHOD_LABELS[e.split_method]}
            </p>
            {group ? (
              <Link to={`/groups/${group.id}`} className="mt-2 inline-flex items-center gap-2 text-sm font-medium hover:underline">
                <GroupBadge emoji={group.emoji} color={group.color} size="sm" /> {group.name}
              </Link>
            ) : (
              !e.group_id && <p className="mt-2 text-sm text-fg-muted">Between friends</p>
            )}
          </div>
          {!deleted && (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><Link to={`/expenses/${e.id}/edit`}><Pencil /> Edit</Link></Button>
              <Button asChild variant="outline"><Link to={`/expenses/new?duplicate=${e.id}`}><Copy /> Duplicate</Link></Button>
              <Button variant="danger-ghost" onClick={() => setConfirmDelete(true)}><Trash2 /> Delete</Button>
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section>
          <SectionTitle>Who paid and who owes</SectionTitle>
          <Card className="divide-y divide-border">
            {people.map((uid) => {
              const paid = payers.filter((p) => p.user_id === uid).reduce((a, p) => a + Number(p.amount_minor), 0);
              const owes = splits.filter((s) => s.user_id === uid).reduce((a, s) => a + Number(s.amount_minor), 0);
              const part = parts.find((p) => p.user_id === uid);
              const net = paid - owes;
              const p = contacts.data?.get(uid);
              return (
                <div key={uid} className={`flex items-center gap-3 p-4 ${part && !part.included ? 'opacity-60' : ''}`}>
                  <Avatar name={p?.display_name ?? '?'} color={p?.avatar_color} size="sm" />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">{nameOf(uid)}{uid === me ? '' : ''}</p>
                    <p className="text-xs text-fg-muted">
                      {paid > 0 && <>paid {formatMoney(paid, e.currency)} · </>}
                      {part && !part.included ? 'excluded' : <>share {formatMoney(owes, e.currency)}</>}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className={`tabular text-sm font-semibold ${net > 0 ? 'text-positive' : net < 0 ? 'text-negative' : 'text-fg-subtle'}`}>
                      {net === 0 ? 'even' : `${net > 0 ? 'gets back' : 'owes'} ${formatMoney(Math.abs(net), e.currency)}`}
                    </span>
                    {uid === me && !deleted && <ItemPayStatus expense={e} />}
                  </div>
                </div>
              );
            })}
          </Card>

          {e.split_method === 'itemized' && (e.expense_items?.length ?? 0) > 0 && (
            <div className="mt-6">
              <SectionTitle>Receipt items</SectionTitle>
              <Card className="divide-y divide-border">
                {e.expense_items!.map((i) => (
                  <div key={i.id} className="flex items-center gap-3 p-3 text-sm">
                    <span className="flex-1">
                      {i.name} {i.kind !== 'item' && <Badge className="ml-1">{i.kind}</Badge>}
                      {i.kind === 'item' && <span className="block text-xs text-fg-subtle">{(i.expense_item_assignments ?? []).map((a) => nameOf(a.user_id)).join(', ')}</span>}
                    </span>
                    <span className="tabular">{i.kind === 'discount' ? '−' : ''}{formatMoney(Number(i.amount_minor), e.currency)}</span>
                  </div>
                ))}
              </Card>
            </div>
          )}

          {(e.notes || e.tags.length > 0) && (
            <div className="mt-6">
              <SectionTitle>Notes</SectionTitle>
              <Card className="space-y-3 p-4 text-sm">
                {e.notes && <p className="whitespace-pre-wrap">{e.notes}</p>}
                {e.tags.length > 0 && <div className="flex flex-wrap gap-1.5">{e.tags.map((t) => <Badge key={t}>#{t}</Badge>)}</div>}
              </Card>
            </div>
          )}

          {e.receipt_id && (
            <div className="mt-6">
              <SectionTitle>Receipt</SectionTitle>
              <Card className="p-4">
                {receipt.isLoading ? <Skeleton className="h-40" /> : receipt.data?.url ? (
                  receipt.data.meta?.mime_type === 'application/pdf' ? (
                    <a href={receipt.data.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"><FileText className="size-4" /> Open PDF receipt</a>
                  ) : (
                    <a href={receipt.data.url} target="_blank" rel="noreferrer"><img src={receipt.data.url} alt={`Receipt for ${e.description}`} className="max-h-96 rounded-2xl ring-1 ring-inset ring-border object-contain" /></a>
                  )
                ) : (
                  <p className="text-sm text-fg-muted">{receipt.data?.meta?.merchant ? `Merchant: ${receipt.data.meta.merchant}` : 'No receipt image.'}</p>
                )}
                {receipt.data?.meta?.merchant && receipt.data.url && <p className="mt-2 text-sm text-fg-muted">Merchant: {receipt.data.meta.merchant}</p>}
              </Card>
            </div>
          )}
        </section>

        <section className="space-y-6">
          <Comments expenseId={e.id} disabled={deleted} />
          <div>
            <SectionTitle><span className="inline-flex items-center gap-1.5"><History className="size-3.5" /> History</span></SectionTitle>
            <Card className="p-4">
              <ol className="space-y-3 border-l border-border pl-4">
                {(revisions.data ?? []).map((r) => (
                  <li key={r.id} className="relative text-sm">
                    <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-primary" />
                    <p>
                      <strong>{nameOf(r.changed_by)}</strong> {r.change_type} this expense
                      {r.change_type === 'updated' && r.snapshot.expense.amount_minor !== undefined && <> — {formatMoney(Number(r.snapshot.expense.amount_minor), String(r.snapshot.expense.currency ?? e.currency))}</>}
                    </p>
                    <p className="text-xs text-fg-subtle">v{r.version} · {formatRelative(r.created_at)}</p>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-2xs text-fg-subtle">Every change is kept. Edits reverse the old amounts and apply the new ones exactly once.</p>
            </Card>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this expense?"
        description="Balances will be recalculated without it. You or another participant can restore it later — the history is kept."
        confirmLabel="Delete expense"
        destructive
        loading={busy}
        onConfirm={() => act('delete_expense')}
      />
    </div>
  );
}

function Comments({ expenseId, disabled }: { expenseId: string; disabled: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const comments = useComments(expenseId);
  const contacts = useContacts();
  const nameOf = useNameOf();
  const [body, setBody] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const post = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('comments').insert({ expense_id: expenseId, author_id: user!.id, body: body.trim() });
    setBusy(false);
    if (error) toast.error(errorMessage(error));
    else {
      setBody('');
      void qc.invalidateQueries({ queryKey: qk.comments(expenseId) });
    }
  };
  const remove = async (id: string) => {
    const { error } = await supabase.from('comments').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) toast.error(errorMessage(error));
    else void qc.invalidateQueries({ queryKey: qk.comments(expenseId) });
  };
  return (
    <div>
      <SectionTitle><span className="inline-flex items-center gap-1.5"><MessageSquare className="size-3.5" /> Comments</span></SectionTitle>
      <Card className="p-4">
        {comments.data?.length ? (
          <ul className="mb-4 space-y-3">
            {comments.data.map((c) => (
              <li key={c.id} className="flex gap-2.5">
                <Avatar name={contacts.data?.get(c.author_id)?.display_name ?? '?'} color={contacts.data?.get(c.author_id)?.avatar_color} size="xs" className="mt-0.5" />
                <div className="min-w-0 flex-1 rounded-xl bg-fg/[0.04] px-3 py-2 text-sm">
                  <p className="text-xs text-fg-subtle">
                    <span className="font-medium text-fg">{nameOf(c.author_id)}</span> · {formatRelative(c.created_at)}
                    {c.author_id === user?.id && <button onClick={() => remove(c.id)} className="ml-2 text-fg-subtle hover:text-negative">delete</button>}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{c.body}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-fg-subtle">No comments yet.</p>
        )}
        {!disabled && (
          <form onSubmit={post} className="flex items-end gap-2">
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={1} maxLength={1000} placeholder="Add a comment…" aria-label="Comment" className="min-h-[40px]" />
            <Button type="submit" size="icon" aria-label="Post comment" loading={busy} disabled={!body.trim()}><Send /></Button>
          </form>
        )}
      </Card>
    </div>
  );
}
