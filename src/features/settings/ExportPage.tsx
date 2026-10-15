import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileJson, FileSpreadsheet, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { toJSON } from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { downloadFile, todayISO } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { useCategories, useGroups, useMe, useNameOf } from '@/data/queries';
import { Card } from '@/components/ui/card';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/layout-bits';
import { PlusGate } from '@/components/domain';
import { expensesToCSV, expensesToJSON, fetchExpensesForExport, fetchSettlementsForExport, settlementsToCSV, type Lookups } from './exporters';

export default function ExportPage() {
  useDocumentTitle('Export centre');
  const [params] = useSearchParams();
  const { user } = useAuth();
  const me = useMe();
  const groups = useGroups();
  const categories = useCategories();
  const nameOf = useNameOf();
  const [groupId, setGroupId] = React.useState(params.get('group') ?? '');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);

  const lookups: Lookups = {
    me: user!.id,
    name: (id) => nameOf(id, { you: false }),
    category: (id) => (id ? categories.data?.find((c) => c.id === id)?.name ?? '' : ''),
    group: (id) => (id ? groups.data?.find((g) => g.id === id)?.name ?? 'Former group' : 'Non-group'),
  };
  const slug = (groupId ? groups.data?.find((g) => g.id === groupId)?.name ?? 'group' : 'all').toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const run = async (kind: 'expenses-csv' | 'expenses-json' | 'settlements-csv' | 'report-json') => {
    setBusy(kind);
    try {
      const f = { groupId: groupId || undefined, from: from || undefined, to: to || undefined };
      if (kind === 'settlements-csv') {
        const s = await fetchSettlementsForExport(supabase, f);
        downloadFile(`owenil-repayments-${slug}-${todayISO()}.csv`, settlementsToCSV(s, lookups), 'text/csv;charset=utf-8');
        toast.success(`Exported ${s.length} repayments`);
        return;
      }
      const ex = await fetchExpensesForExport(supabase, f);
      if (kind === 'expenses-csv') downloadFile(`owenil-expenses-${slug}-${todayISO()}.csv`, expensesToCSV(ex, lookups), 'text/csv;charset=utf-8');
      else if (kind === 'expenses-json') downloadFile(`owenil-expenses-${slug}-${todayISO()}.json`, toJSON({ exported_at: new Date().toISOString(), filter: f, expenses: expensesToJSON(ex, lookups) }), 'application/json');
      else {
        const settlements = await fetchSettlementsForExport(supabase, f);
        const balances = groupId ? (await supabase.rpc('get_group_balances', { p_group_id: groupId })).data : null;
        downloadFile(`owenil-report-${slug}-${todayISO()}.json`, toJSON({
          exported_at: new Date().toISOString(),
          group: groupId ? groups.data?.find((g) => g.id === groupId)?.name : null,
          period: { from: from || null, to: to || null },
          note: 'Amounts are integer minor units of each currency. Balances are per currency and never combined.',
          balances: (balances as { user_id: string; currency: string; net_minor: number }[] | null)?.map((b) => ({ ...b, name: lookups.name(b.user_id) })) ?? null,
          expenses: expensesToJSON(ex, lookups),
          repayments: settlements,
        }), 'application/json');
      }
      toast.success(`Exported ${ex.length} expenses`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (me.isLoading) return <Skeleton className="h-64 rounded-2xl" />;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Export centre" description="Download the records you can see, as CSV for spreadsheets or JSON for other tools." />
      <Card className="flex items-start gap-3 p-4 text-sm">
        <Shield className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-fg-muted">A complete copy of your own account data is always free — see <Link to="/settings/privacy" className="font-medium text-primary hover:underline">Privacy</Link>.</p>
      </Card>
      {me.data?.isPlus ? (
        <Card className="space-y-5 p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Group" htmlFor="e-group">
              <NativeSelect id="e-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">Everything</option>
                {(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="From" htmlFor="e-from"><Input id="e-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To" htmlFor="e-to"><Input id="e-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ExportButton icon={FileSpreadsheet} title="Expenses (CSV)" desc="One row per expense with payers, shares and your net." loading={busy === 'expenses-csv'} onClick={() => run('expenses-csv')} />
            <ExportButton icon={FileJson} title="Expenses (JSON)" desc="Structured data with exact minor-unit amounts." loading={busy === 'expenses-json'} onClick={() => run('expenses-json')} />
            <ExportButton icon={FileSpreadsheet} title="Repayments (CSV)" desc="All recorded and reversed repayments." loading={busy === 'settlements-csv'} onClick={() => run('settlements-csv')} />
            <ExportButton icon={FileJson} title={groupId ? 'Group report (JSON)' : 'Full report (JSON)'} desc="Balances, expenses and repayments together." loading={busy === 'report-json'} onClick={() => run('report-json')} />
          </div>
        </Card>
      ) : (
        <PlusGate feature="CSV & JSON exports" description="Export expenses, repayments and detailed group reports for any period." />
      )}
    </div>
  );
}

function ExportButton({ icon: Icon, title, desc, loading, onClick }: { icon: React.ElementType; title: string; desc: string; loading: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={loading} className="flex items-start gap-3 rounded-2xl ring-1 ring-inset ring-border p-4 text-left transition-all hover:border-primary hover:bg-primary-soft/40 disabled:opacity-60">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><Icon className="size-5" /></span>
      <span>
        <span className="block font-medium">{loading ? 'Preparing…' : title}</span>
        <span className="block text-xs text-fg-muted">{desc}</span>
      </span>
    </button>
  );
}

