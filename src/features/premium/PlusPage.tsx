import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Check, FlaskConical, Info, Minus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
import { errorMessage, unwrap } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { formatDate } from '@/lib/utils';
import { qk, useDevStatus, useMe } from '@/data/queries';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';

const FEATURES: [string, boolean | string, boolean | string][] = [
  ['Unlimited groups, friends & expenses', true, true],
  ['All six split methods (except itemized)', true, true],
  ['Multiple payers & exact paisa rounding', true, true],
  ['Balances, debt simplification & repayments', true, true],
  ['Recurring expenses', 'Up to 3, weekly/monthly', 'Unlimited, any schedule'],
  ['Analytics', '6 months', 'Full history & comparisons'],
  ['Itemized receipt splitting', false, true],
  ['Private receipt uploads', false, true],
  ['Budgets & alerts', false, true],
  ['Currency conversion with your rate snapshots', false, true],
  ['Saved split presets & saved filters', false, true],
  ['CSV & JSON exports, group reports', 'Account data export', true],
  ['Advanced search & payer breakdowns', false, true],
  ['Ad-free', true, true],
];

export default function PlusPage() {
  useDocumentTitle('Owenil Plus');
  const me = useMe();
  const dev = useDevStatus();
  const qc = useQueryClient();
  const [billing, setBilling] = React.useState<'monthly' | 'yearly'>('yearly');
  const [busy, setBusy] = React.useState(false);
  const isPlus = !!me.data?.isPlus;

  const setPlan = async (plan: 'free' | 'plus') => {
    setBusy(true);
    try {
      unwrap(await supabase.rpc('dev_set_plan', { p_plan: plan }));
      toast.success(plan === 'plus' ? 'Owenil Plus enabled (development entitlement)' : 'Switched back to Free');
      await qc.invalidateQueries({ queryKey: qk.me });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="hero-card relative overflow-hidden rounded-[32px] p-8 sm:p-12">
        <div className="relative max-w-2xl">
          <Badge className="hero-chip text-white"><Sparkles /> Owenil Plus</Badge>
          <h1 className="mt-4 text-3xl font-bold sm:text-5xl">See the whole picture of your shared money.</h1>
          <p className="mt-3 text-white/70">Receipts, itemised bills, budgets with alerts, multi-currency reports and exports — for people who split a lot.</p>
          {isPlus && (
            <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm">
              <Check className="size-4 text-emerald-300" /> Plus is active
              {me.data?.entitlement?.source === 'development' && ' · development entitlement'}
              {me.data?.entitlement?.current_period_end && ` · until ${formatDate(me.data.entitlement.current_period_end)}`}
            </p>
          )}
        </div>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <caption className="sr-only">Free vs Plus feature comparison</caption>
            <thead>
              <tr className="border-b border-border bg-fg/[0.04] text-left">
                <th className="p-4 font-medium">Feature</th>
                <th className="w-32 p-4 text-center font-medium">Free</th>
                <th className="w-40 p-4 text-center font-medium text-plus">Plus</th>
              </tr>
            </thead>
            <tbody>
              {FEATURES.map(([f, free, plus]) => (
                <tr key={f} className="border-b border-border last:border-0">
                  <td className="p-4">{f}</td>
                  {[free, plus].map((v, i) => (
                    <td key={i} className="p-4 text-center text-xs">
                      {v === true ? <Check className="mx-auto size-4 text-positive" aria-label="Included" /> : v === false ? <Minus className="mx-auto size-4 text-fg-subtle" aria-label="Not included" /> : v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div className="space-y-4">
          <Card className="p-6">
            <Segmented value={billing} onChange={setBilling} className="w-full" ariaLabel="Billing period" options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} />
            <p className="mt-5 font-display text-4xl font-semibold">
              {billing === 'monthly' ? env.plusPriceMonthly : env.plusPriceYearly}
              <span className="text-base font-normal text-fg-muted">/{billing === 'monthly' ? 'month' : 'year'}</span>
            </p>
            <Button variant="plus" size="lg" className="mt-5 w-full" disabled>
              <Sparkles /> Subscriptions coming soon
            </Button>
            <p className="mt-3 flex items-start gap-2 text-xs text-fg-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" /> Payments aren’t enabled in this release. No card is ever requested and nothing will be charged. Prices shown are indicative.
            </p>
          </Card>

          {env.devTools && (
            <Card className="border-dashed p-6">
              <p className="flex items-center gap-2 font-semibold"><FlaskConical className="size-4 text-warning" /> Development entitlement</p>
              {dev.isLoading ? (
                <p className="mt-2 text-sm text-fg-muted">Checking…</p>
              ) : dev.data?.premium_switch_allowed ? (
                <>
                  <p className="mt-2 text-sm text-fg-muted">
                    {dev.data.mode === 'everyone'
                      ? 'Plus is switched on for everyone while Owenil is being tested. Switch back to Free to try the free version.'
                      : <>For testing only. The database verified that this account may use the switch in a development environment (mode: <code>{dev.data.mode}</code>).</>}
                  </p>
                  <Button className="mt-4 w-full" variant={isPlus ? 'outline' : 'primary'} loading={busy} onClick={() => setPlan(isPlus ? 'free' : 'plus')}>
                    {isPlus ? 'Switch back to Free' : 'Enable Plus for testing'}
                  </Button>
                </>
              ) : (
                <p className="mt-2 text-sm text-fg-muted">
                  Not available for this account (server mode: <code>{dev.data?.mode ?? 'off'}</code>). An administrator can mark a tester with <code className="rounded bg-fg/[0.06] px-1">npm run db:tester -- you@example.com</code>.
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
