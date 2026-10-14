import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Bookmark, Filter, Plus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { CURRENCIES } from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { useDebounced, useDocumentTitle } from '@/lib/hooks';
import { useAuth } from '@/features/auth/AuthProvider';
import { qk, useCategories, useExpenses, useGroups, useMe, useSavedFilters, type ExpenseFilters } from '@/data/queries';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { Badge, Skeleton, Switch } from '@/components/ui/misc';
import { EmptyState, ErrorState, FitBody, FitScreen, PageHeader } from '@/components/ui/layout-bits';
import { ExpenseRow, PlusBadge } from '@/components/domain';

const PAGE_SIZE = 25;
const FILTER_KEYS = ['search', 'group', 'category', 'currency', 'from', 'to', 'mine', 'deleted', 'sort'] as const;

export default function ExpensesPage() {
  useDocumentTitle('Expenses');
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const me = useMe();
  const groups = useGroups();
  const categories = useCategories();
  const saved = useSavedFilters();
  const [showFilters, setShowFilters] = React.useState(false);
  const [search, setSearch] = React.useState(params.get('search') ?? '');
  const searchRef = React.useRef<HTMLInputElement>(null);
  const q = useDebounced(search, 300);
  const page = Number(params.get('page') ?? '0');

  React.useEffect(() => {
    if (params.get('focus') === 'search') searchRef.current?.focus();
  }, [params]);
  React.useEffect(() => {
    if ((params.get('search') ?? '') !== q) update({ search: q || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  // Only adopt the URL value when it changed externally (e.g. the top-bar search), never mid-typing.
  const urlSearch = params.get('search') ?? '';
  React.useEffect(() => {
    if (urlSearch !== q) setSearch(urlSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearch]);

  function update(patch: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    next.delete('focus');
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  }

  const filters: ExpenseFilters = {
    search: params.get('search') ?? undefined,
    groupId: (params.get('group') as ExpenseFilters['groupId']) ?? undefined,
    categoryId: params.get('category') ?? undefined,
    currency: params.get('currency') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    involvingMe: params.get('mine') === '1',
    includeDeleted: params.get('deleted') === '1',
    sort: (params.get('sort') as ExpenseFilters['sort']) ?? 'date_desc',
    page,
    pageSize: PAGE_SIZE,
  };
  const expenses = useExpenses(filters);
  const catMap = React.useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);
  const groupName = (id: string | null) => (id ? groups.data?.find((g) => g.id === id)?.name ?? null : null);
  const activeFilterCount = ['group', 'category', 'currency', 'from', 'to', 'mine', 'deleted'].filter((k) => params.get(k)).length;
  const total = expenses.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const saveFilter = async () => {
    const name = window.prompt('Name this filter');
    if (!name?.trim()) return;
    const f: Record<string, string> = {};
    for (const k of FILTER_KEYS) {
      const v = params.get(k);
      if (v) f[k] = v;
    }
    const { error } = await supabase.from('saved_filters').insert({ user_id: user!.id, name: name.trim().slice(0, 60), filters: f });
    if (error) toast.error(errorMessage(error));
    else {
      toast.success('Filter saved');
      void qc.invalidateQueries({ queryKey: qk.savedFilters });
    }
  };
  const deleteFilter = async (id: string) => {
    const { error } = await supabase.from('saved_filters').delete().eq('id', id);
    if (error) toast.error(errorMessage(error));
    else void qc.invalidateQueries({ queryKey: qk.savedFilters });
  };

  return (
    <FitScreen>
      <PageHeader
        title="Expenses"
        description="Search and filter everything you can see."
        actions={<Button asChild><Link to="/expenses/new"><Plus /> Add expense</Link></Button>}
      />

      <div className="mb-3 flex shrink-0 gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by description" className="pl-9" aria-label="Search expenses" />
        </div>
        <div className="flex gap-2">
          <NativeSelect value={filters.sort} onChange={(e) => update({ sort: e.target.value === 'date_desc' ? null : e.target.value })} aria-label="Sort" className="w-[7.5rem] sm:w-44">
            <option value="date_desc">Newest first</option>
            <option value="date_asc">Oldest first</option>
            <option value="amount_desc">Largest first</option>
            <option value="amount_asc">Smallest first</option>
          </NativeSelect>
          <Button variant={showFilters ? 'secondary' : 'outline'} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} aria-label="Filters" className="px-3 sm:px-5">
            <Filter /> <span className="hidden sm:inline">Filters</span> {activeFilterCount > 0 && <Badge tone="primary">{activeFilterCount}</Badge>}
          </Button>
        </div>
      </div>

      <FitBody>
      {(saved.data?.length ?? 0) > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Bookmark className="size-4 text-fg-subtle" />
          {saved.data!.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface pl-3 text-sm">
              <button onClick={() => setParams(new URLSearchParams(s.filters), { replace: true })} className="hover:text-primary">{s.name}</button>
              <button onClick={() => deleteFilter(s.id)} className="rounded-full p-1.5 text-fg-subtle hover:text-negative" aria-label={`Delete saved filter ${s.name}`}><X className="size-3" /></button>
            </span>
          ))}
        </div>
      )}

      {showFilters && (
        <Card className="mb-4 grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Group" htmlFor="f-group">
            <NativeSelect id="f-group" value={params.get('group') ?? ''} onChange={(e) => update({ group: e.target.value })}>
              <option value="">All</option>
              <option value="none">Non-group (friends)</option>
              {(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.emoji} {g.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Category" htmlFor="f-cat">
            <NativeSelect id="f-cat" value={params.get('category') ?? ''} onChange={(e) => update({ category: e.target.value })}>
              <option value="">All</option>
              {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Currency" htmlFor="f-cur">
            <NativeSelect id="f-cur" value={params.get('currency') ?? ''} onChange={(e) => update({ currency: e.target.value })}>
              <option value="">All</option>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From" htmlFor="f-from"><Input id="f-from" type="date" value={params.get('from') ?? ''} onChange={(e) => update({ from: e.target.value })} /></Field>
            <Field label="To" htmlFor="f-to"><Input id="f-to" type="date" value={params.get('to') ?? ''} onChange={(e) => update({ to: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-3 text-sm"><Switch checked={params.get('mine') === '1'} onCheckedChange={(v) => update({ mine: v ? '1' : null })} /> Only expenses I’m in</label>
          <label className="flex items-center gap-3 text-sm"><Switch checked={params.get('deleted') === '1'} onCheckedChange={(v) => update({ deleted: v ? '1' : null })} /> Show deleted (to restore)</label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:justify-end">
            {me.data?.isPlus ? (
              <Button size="sm" variant="outline" onClick={saveFilter}><Bookmark /> Save filter</Button>
            ) : (
              <span className="inline-flex items-center gap-2 text-xs text-fg-muted">Saved filters <PlusBadge /></span>
            )}
            <Button size="sm" variant="ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear all</Button>
          </div>
        </Card>
      )}

      <Card className="p-2">
        {expenses.isLoading ? (
          <div className="space-y-2 p-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : expenses.isError ? (
          <ErrorState error={expenses.error} onRetry={() => expenses.refetch()} />
        ) : expenses.data?.rows.length ? (
          <>
            <p className="px-3 py-2 text-xs text-fg-subtle">{total} expense{total === 1 ? '' : 's'}</p>
            {expenses.data.rows.map((e) => <ExpenseRow key={e.id} expense={e} categories={catMap} groupName={groupName(e.group_id)} />)}
            {pages > 1 && (
              <nav aria-label="Pagination" className="flex items-center justify-between border-t border-border p-2 text-sm">
                <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => update({ page: String(page - 1) }, false)}>Previous</Button>
                <span className="text-fg-muted">Page {page + 1} of {pages}</span>
                <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => update({ page: String(page + 1) }, false)}>Next</Button>
              </nav>
            )}
          </>
        ) : (
          <EmptyState
            title={activeFilterCount || filters.search ? 'Nothing matches' : 'No expenses yet'}
            description={activeFilterCount || filters.search ? 'Try removing some filters.' : 'Add your first expense to get started.'}
            action={activeFilterCount || filters.search ? <Button variant="outline" onClick={() => { setSearch(''); setParams(new URLSearchParams(), { replace: true }); }}>Clear filters</Button> : <Button asChild><Link to="/expenses/new"><Plus /> Add expense</Link></Button>}
          />
        )}
      </Card>
      </FitBody>
    </FitScreen>
  );
}
