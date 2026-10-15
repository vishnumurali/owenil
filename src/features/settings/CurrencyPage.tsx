import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Info, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { CURRENCIES, convertMinor, exchangeRateSchema, formatMoney, getCurrency } from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { formatDate, todayISO } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { qk, useMe, useRates } from '@/data/queries';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { PageHeader, SectionTitle } from '@/components/ui/layout-bits';
import { PlusGate } from '@/components/domain';

export default function CurrencyPage() {
  useDocumentTitle('Currency');
  const { user } = useAuth();
  const me = useMe();
  const qc = useQueryClient();
  const rates = useRates();
  const [base, setBase] = React.useState('USD');
  const [quote, setQuote] = React.useState('INR');
  const [rate, setRate] = React.useState('');
  const [asOf, setAsOf] = React.useState(todayISO());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (me.data) setQuote(me.data.profile.default_currency);
  }, [me.data]);

  if (me.isLoading || !me.data) return <Skeleton className="h-96 rounded-2xl" />;

  const updateProfileCurrency = async (code: string) => {
    const { error: err } = await supabase.from('profiles').update({ default_currency: code }).eq('id', user!.id);
    if (err) toast.error(errorMessage(err));
    else {
      toast.success(`Default currency set to ${code}`);
      void qc.invalidateQueries({ queryKey: qk.me });
    }
  };
  const updateReport = async (code: string) => {
    const { error: err } = await supabase.from('user_preferences').update({ report_currency: code || null }).eq('user_id', user!.id);
    if (err) toast.error(errorMessage(err));
    else void qc.invalidateQueries({ queryKey: qk.me });
  };
  const addRate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = exchangeRateSchema.safeParse({ base_currency: base, quote_currency: quote, rate: rate.trim(), as_of: asOf });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the rate');
    setBusy(true);
    const { error: err } = await supabase.from('exchange_rate_snapshots').insert({ ...parsed.data, user_id: user!.id });
    setBusy(false);
    if (err) return setError(err.code === '23505' ? 'You already saved a rate for this pair on that date.' : errorMessage(err));
    setRate('');
    toast.success('Rate saved');
    void qc.invalidateQueries({ queryKey: qk.rates });
  };
  const preview = (() => {
    try {
      if (!rate || Number(rate) <= 0) return null;
      const one = 10 ** getCurrency(base).minorUnits * 100;
      return `${formatMoney(one, base)} = ${formatMoney(convertMinor(one, base, quote, rate.trim()), quote)}`;
    } catch {
      return null;
    }
  })();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Currency" description="Every expense keeps its own currency. Balances are kept separately per currency." />
      <Card className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
        <Field label="Default currency" htmlFor="c-default" hint="Pre-selected for new expenses and your dashboard.">
          <NativeSelect id="c-default" value={me.data.profile.default_currency} onChange={(e) => updateProfileCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name} ({c.symbol})</option>)}
          </NativeSelect>
        </Field>
        <Field label="Reporting currency" htmlFor="c-report" hint="Used by Analytics. Others are shown separately or converted with your rates.">
          <NativeSelect id="c-report" value={me.data.preferences.report_currency ?? ''} onChange={(e) => updateReport(e.target.value)}>
            <option value="">Same as default</option>
            {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </NativeSelect>
        </Field>
        <p className="flex items-start gap-2 text-xs text-fg-muted sm:col-span-2">
          <Info className="mt-0.5 size-3.5 shrink-0" /> Supported: {CURRENCIES.map((c) => c.code).join(', ')}. Precision follows each currency (e.g. ¥ has no decimals, KWD has three).
        </p>
      </Card>

      <section>
        <SectionTitle>Exchange-rate snapshots</SectionTitle>
        {me.data.isPlus ? (
          <Card className="p-5 sm:p-6">
            <p className="mb-4 text-sm text-fg-muted">Owenil doesn’t fetch live rates. Record the rate you actually used (from your bank or card statement); reports use the latest snapshot on or before each expense date.</p>
            <form onSubmit={addRate} className="grid gap-3 sm:grid-cols-[100px_100px_1fr_150px_auto] sm:items-end">
              <Field label="1 unit of" htmlFor="r-base"><NativeSelect id="r-base" value={base} onChange={(e) => setBase(e.target.value)}>{CURRENCIES.map((c) => <option key={c.code}>{c.code}</option>)}</NativeSelect></Field>
              <Field label="equals" htmlFor="r-quote"><NativeSelect id="r-quote" value={quote} onChange={(e) => setQuote(e.target.value)}>{CURRENCIES.map((c) => <option key={c.code}>{c.code}</option>)}</NativeSelect></Field>
              <Field label="Rate" htmlFor="r-rate"><Input id="r-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 83.25" className="tabular" /></Field>
              <Field label="As of" htmlFor="r-date"><Input id="r-date" type="date" value={asOf} max={todayISO()} onChange={(e) => setAsOf(e.target.value)} /></Field>
              <Button type="submit" loading={busy}><Plus /> Add</Button>
            </form>
            {preview && <p className="mt-2 text-xs text-fg-muted">Preview: {preview}</p>}
            {error && <p role="alert" className="mt-2 text-sm text-negative">{error}</p>}
            <div className="mt-5 divide-y divide-border rounded-2xl ring-1 ring-inset ring-border">
              {rates.data?.length ? rates.data.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="tabular flex-1">1 {r.base_currency} = {Number(r.rate).toLocaleString('en-IN', { maximumFractionDigits: 10 })} {r.quote_currency}</span>
                  <span className="text-xs text-fg-subtle">{formatDate(r.as_of)} · manual</span>
                  <Button size="icon-sm" variant="ghost" aria-label="Delete rate" onClick={async () => {
                    const { error: err } = await supabase.from('exchange_rate_snapshots').delete().eq('id', r.id);
                    if (err) toast.error(errorMessage(err));
                    else void qc.invalidateQueries({ queryKey: qk.rates });
                  }}><Trash2 /></Button>
                </div>
              )) : <p className="p-4 text-center text-sm text-fg-subtle">No rates recorded yet.</p>}
            </div>
          </Card>
        ) : (
          <PlusGate feature="Currency conversion" description="Record exchange-rate snapshots and see reports converted into one currency — with the rate and date always shown." />
        )}
      </section>
    </div>
  );
}
