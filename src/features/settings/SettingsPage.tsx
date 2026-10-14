import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Coins, Download, FlaskConical, Monitor, Moon, RefreshCw, Shield, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { CURRENCIES, profileFormSchema } from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { env } from '@/lib/env';
import { errorMessage, unwrap } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { invalidateFinancial, qk, useMe } from '@/data/queries';
import type { Preferences } from '@/types/db';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { Skeleton, Switch } from '@/components/ui/misc';
import { Avatar } from '@/components/ui/avatar';
import { PageHeader } from '@/components/ui/layout-bits';

const AVATAR_COLORS = ['#14b8a6', '#10b981', '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#64748b'];

function timeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['Asia/Kolkata', 'UTC'];
  } catch {
    return ['Asia/Kolkata', 'UTC'];
  }
}

export default function SettingsPage() {
  useDocumentTitle('Profile & preferences');
  const me = useMe();
  const qc = useQueryClient();
  const { theme, setTheme } = useTheme();
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState('#14b8a6');
  const [currency, setCurrency] = React.useState('INR');
  const [tz, setTz] = React.useState('Asia/Kolkata');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const zones = React.useMemo(timeZones, []);

  React.useEffect(() => {
    if (me.data) {
      setName(me.data.profile.display_name);
      setColor(me.data.profile.avatar_color);
      setCurrency(me.data.profile.default_currency);
      setTz(me.data.profile.timezone);
    }
  }, [me.data]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = profileFormSchema.safeParse({ display_name: name, default_currency: currency, timezone: tz });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check your details');
    setBusy(true);
    const { error: err } = await supabase.from('profiles').update({ ...parsed.data, avatar_color: color }).eq('id', me.data!.profile.id);
    setBusy(false);
    if (err) return setError(errorMessage(err));
    toast.success('Profile saved');
    void qc.invalidateQueries({ queryKey: qk.me });
    void qc.invalidateQueries({ queryKey: qk.contacts });
  };

  const setPref = async (patch: Partial<Preferences>) => {
    const { error: err } = await supabase.from('user_preferences').update(patch).eq('user_id', me.data!.profile.id);
    if (err) toast.error(errorMessage(err));
    else void qc.invalidateQueries({ queryKey: qk.me });
  };

  const chooseTheme = (t: ThemePreference) => {
    setTheme(t);
    void setPref({ theme: t });
  };

  if (me.isLoading || !me.data) return <Skeleton className="h-96 rounded-2xl" />;
  const p = me.data.preferences;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Profile & preferences" description={me.data.email} />

      <Card className="p-5 sm:p-6">
        <h2 className="mb-4 font-semibold">Profile</h2>
        <form onSubmit={saveProfile} className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar name={name || '?'} color={color} size="xl" />
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Avatar colour">
              {AVATAR_COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Colour ${c}`} onClick={() => setColor(c)}
                  className="flex size-8 items-center justify-center rounded-full transition-transform hover:scale-110" style={{ background: c, boxShadow: color === c ? `0 0 0 2px hsl(var(--surface)), 0 0 0 4px ${c}` : undefined }}>
                  {color === c && <Check className="size-4 text-white" />}
                </button>
              ))}
            </div>
          </div>
          <Field label="Display name" htmlFor="s-name"><Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Default currency" htmlFor="s-cur">
              <NativeSelect id="s-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Time zone" htmlFor="s-tz" hint="Used for “today” and recurring schedules.">
              <NativeSelect id="s-tz" value={tz} onChange={(e) => setTz(e.target.value)}>
                {zones.map((z) => <option key={z} value={z}>{z}</option>)}
              </NativeSelect>
            </Field>
          </div>
          {error && <p role="alert" className="text-sm text-negative">{error}</p>}
          <div className="flex justify-end"><Button type="submit" loading={busy}>Save profile</Button></div>
        </form>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="mb-4 font-semibold">Appearance</h2>
        <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Theme">
          {([['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]] as const).map(([v, label, Icon]) => (
            <button key={v} role="radio" aria-checked={theme === v} onClick={() => chooseTheme(v)}
              className={cn('flex flex-col items-center gap-2 rounded-xl border p-4 text-sm font-medium transition-all', theme === v ? 'border-primary bg-primary-soft text-primary' : 'border-border hover:bg-muted')}>
              <Icon className="size-5" /> {label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-fg-subtle">Animations follow your system’s “reduce motion” setting.</p>
      </Card>

      <Card className="p-5 sm:p-6" id="notifications">
        <h2 className="mb-4 font-semibold">In-app notifications</h2>
        <div className="divide-y divide-border">
          {([
            ['notify_expenses', 'Expenses added, edited or deleted'],
            ['notify_settlements', 'Repayments recorded or reversed'],
            ['notify_comments', 'Comments on your expenses'],
            ['notify_budget_alerts', 'Budget alerts (Plus)'],
            ['notify_recurring', 'Recurring expenses created or paused'],
          ] as const).map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-4 py-3 text-sm">
              {label}
              <Switch checked={p[k]} onCheckedChange={(v) => setPref({ [k]: v })} aria-label={label} />
            </label>
          ))}
        </div>
      </Card>

      <Card className="divide-y divide-border">
        {[
          { to: '/settings/currency', icon: Coins, label: 'Currency & exchange rates' },
          { to: '/settings/privacy', icon: Shield, label: 'Privacy, data export & account deletion' },
          { to: '/export', icon: Download, label: 'Export centre' },
        ].map((l) => (
          <Link key={l.to} to={l.to} className="flex items-center gap-3 p-4 text-sm font-medium transition-colors hover:bg-muted/50">
            <l.icon className="size-4 text-fg-subtle" /> <span className="flex-1">{l.label}</span> <ChevronRight className="size-4 text-fg-subtle" />
          </Link>
        ))}
      </Card>

      {env.devTools && <DevTools />}
    </div>
  );
}

function DevTools() {
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  return (
    <Card className="border-dashed p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-semibold"><FlaskConical className="size-4 text-warning" /> Developer tools</h2>
      <p className="mt-1 text-sm text-fg-muted">Visible because this build has VITE_ENABLE_DEV_TOOLS=true. Each action is still authorised by the database.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild><Link to="/plus">Premium entitlement switch</Link></Button>
        <Button variant="outline" size="sm" loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const n = unwrap(await supabase.rpc('run_due_recurring_now')) as number;
              toast.success(`Recurring generator ran: ${n} created`);
              invalidateFinancial(qc);
            } catch (e) {
              toast.error(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}>
          <RefreshCw /> Run due recurring expenses
        </Button>
      </div>
      <p className="mt-3 text-xs text-fg-subtle">Reset demo data from your terminal: <code className="rounded bg-muted px-1">npm run db:reset-demo</code></p>
    </Card>
  );
}
