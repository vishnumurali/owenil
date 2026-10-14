import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { HandCoins, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatMoney } from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { errorMessage, unwrap } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { formatDate, formatRelative } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { invalidateFinancial, useGroups, useNameOf, useSettlements } from '@/data/queries';
import type { Settlement } from '@/types/db';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, NativeSelect, Textarea } from '@/components/ui/input';
import { Badge, Skeleton } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/layout-bits';
import { SettleUpDialog } from './SettleUpDialog';

const METHOD: Record<Settlement['method'], string> = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer', card: 'Card', other: 'Other' };

export default function SettlementsPage() {
  useDocumentTitle('Repayments');
  const { user } = useAuth();
  const qc = useQueryClient();
  const groups = useGroups();
  const nameOf = useNameOf();
  const [groupId, setGroupId] = React.useState('');
  const settlements = useSettlements({ groupId: groupId || undefined, limit: 300 });
  const [recordOpen, setRecordOpen] = React.useState(false);
  const [reversing, setReversing] = React.useState<Settlement | null>(null);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const reverse = async () => {
    if (!reversing) return;
    setBusy(true);
    try {
      unwrap(await supabase.rpc('reverse_settlement', { p_settlement_id: reversing.id, p_reason: reason.trim() || null }));
      toast.success('Repayment reversed — balances restored');
      invalidateFinancial(qc);
      setReversing(null);
      setReason('');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Repayments"
        description="Every recorded repayment, including reversals. Records only — Owenil never moves money."
        actions={<Button onClick={() => setRecordOpen(true)}><HandCoins /> Record repayment</Button>}
      />
      <div className="mb-4 max-w-xs">
        <NativeSelect value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="Filter by group">
          <option value="">All groups & friends</option>
          {(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.emoji} {g.name}</option>)}
        </NativeSelect>
      </div>
      <Card className="divide-y divide-border">
        {settlements.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : settlements.isError ? (
          <ErrorState error={settlements.error} onRetry={() => settlements.refetch()} />
        ) : settlements.data?.length ? (
          settlements.data.map((s) => {
            const g = groups.data?.find((x) => x.id === s.group_id);
            const canReverse = !s.reversed_at && (s.payer_id === user?.id || s.payee_id === user?.id || s.created_by === user?.id);
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-3 p-4">
                <span className={`flex size-10 items-center justify-center rounded-xl ${s.reversed_at ? 'bg-muted text-fg-subtle' : 'bg-positive-soft text-positive'}`}>
                  <HandCoins className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${s.reversed_at ? 'line-through opacity-60' : ''}`}>
                    {nameOf(s.payer_id)} paid {nameOf(s.payee_id)}
                  </p>
                  <p className="text-xs text-fg-muted">
                    {formatDate(s.settled_on)} · {METHOD[s.method]} · {g ? `${g.emoji} ${g.name}` : 'Non-group'} · recorded by {nameOf(s.created_by)}
                    {s.note && <> · “{s.note}”</>}
                  </p>
                  {s.reversed_at && <p className="text-xs text-negative">Reversed by {nameOf(s.reversed_by)} {formatRelative(s.reversed_at)}{s.reversal_reason ? ` — ${s.reversal_reason}` : ''}</p>}
                </div>
                {s.is_demo && <Badge tone="warning">Demo</Badge>}
                {s.reversed_at && <Badge tone="negative">Reversed</Badge>}
                <span className="tabular font-semibold">{formatMoney(Number(s.amount_minor), s.currency)}</span>
                {canReverse && (
                  <Button size="sm" variant="ghost" onClick={() => setReversing(s)} aria-label="Reverse repayment"><Undo2 /> Reverse</Button>
                )}
              </div>
            );
          })
        ) : (
          <EmptyState illustration="balanced" title="No repayments yet" description="When someone pays back what they owe, record it here so balances stay accurate." />
        )}
      </Card>
      <SettleUpDialog open={recordOpen} onOpenChange={setRecordOpen} defaults={{ groupId: groupId || undefined }} />
      <Dialog open={!!reversing} onOpenChange={(o) => !o && setReversing(null)} title="Reverse this repayment?" description="Use this if it was recorded by mistake or the payment failed. The original record stays in history."
        footer={<><Button variant="outline" onClick={() => setReversing(null)}>Cancel</Button><Button variant="danger" onClick={reverse} loading={busy}>Reverse repayment</Button></>}>
        <Field label="Reason" htmlFor="rev-reason" optional>
          <Textarea id="rev-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. UPI transfer failed" />
        </Field>
      </Dialog>
    </div>
  );
}
