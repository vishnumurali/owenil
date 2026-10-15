import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight, BarChart3, CalendarClock, Check, Coins, HandCoins, LayoutGrid, Lock, Moon, Receipt, Scale, ShieldCheck, Sparkles, Sun, Users,
} from 'lucide-react';
import { useDocumentTitle } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';

const fadeUp = { initial: { opacity: 0, y: 18 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-60px' }, transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] } };

export default function LandingPage() {
  useDocumentTitle('');
  const { resolved, setTheme } = useTheme();
  return (
    <div className="min-h-dvh overflow-x-hidden bg-bg">
      <header className="glass safe-top sticky top-0 z-30 border-b border-border/60">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5">
          <Logo />
          <nav className="ml-8 hidden gap-6 text-sm text-fg-muted md:flex" aria-label="Sections">
            <a href="#features" className="hover:text-fg">Features</a>
            <a href="#how" className="hover:text-fg">How it works</a>
            <a href="#trust" className="hover:text-fg">Security</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}>
              {resolved === 'dark' ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
            </Button>
            <Button variant="ghost" asChild className="hidden sm:inline-flex"><Link to="/login">Sign in</Link></Button>
            <Button asChild><Link to="/register">Get started</Link></Button>
          </div>
        </div>
      </header>

      <section className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-hero-glow" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-14 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div>
            <motion.p {...fadeUp} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-fg-muted shadow-sm">
              <span className="size-1.5 rounded-full bg-primary" /> Free for everyday splitting
            </motion.p>
            <motion.h1 {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.05 }} className="mt-5 text-balance text-4xl font-semibold leading-[1.08] sm:text-6xl">
              Shared expenses.{' '}
              <span className="bg-brand-gradient bg-clip-text text-transparent">Clear balances.</span>{' '}
              Better together.
            </motion.h1>
            <motion.p {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.1 }} className="mt-5 max-w-xl text-lg text-fg-muted">
              Owenil keeps a fair, exact tab for trips, flatmates, couples and families — so nobody has to do the maths or the awkward reminding.
            </motion.p>
            <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.15 }} className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" asChild><Link to="/register">Create your free account <ArrowRight /></Link></Button>
              <Button size="lg" variant="outline" asChild><Link to="/login">I have an account</Link></Button>
            </motion.div>
            <motion.ul {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.2 }} className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-fg-muted">
              {['Exact to the paisa', 'Any currency', 'Private by design'].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5"><Check className="size-4 text-primary" /> {t}</li>
              ))}
            </motion.ul>
          </div>
          <HeroMock />
        </div>
      </section>

      <section id="features" className="border-t border-border bg-surface/50 py-20">
        <div className="mx-auto max-w-6xl px-5">
          <motion.div {...fadeUp} className="max-w-2xl">
            <h2 className="text-3xl font-semibold sm:text-4xl">Everything a shared wallet needs</h2>
            <p className="mt-3 text-fg-muted">From a quick chai split to a two-week trip with five currencies.</p>
          </motion.div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [LayoutGrid, 'Groups & friends', 'Trips, homes, couples, families — or one-to-one with a friend. Invite with a private link.'],
              [Scale, 'Six ways to split', 'Equally, exact amounts, percentages, weighted shares, adjustments or itemised receipts.'],
              [Users, 'Multiple payers', 'Two people paid the hotel? Record exactly who put in what.'],
              [HandCoins, 'Simplified settle-up', 'The fewest repayments to clear a group, without changing anyone’s total.'],
              [CalendarClock, 'Recurring bills', 'Rent and subscriptions added automatically on schedule — server-side.'],
              [BarChart3, 'Insights & budgets', 'Monthly trends, category breakdowns and budget alerts with Owenil Plus.'],
              [Coins, 'Multi-currency', 'Every expense keeps its currency. Conversions use rates you choose — never guesses.'],
              [Receipt, 'Receipts', 'Attach private receipt photos and assign items to people (Plus).'],
              [ShieldCheck, 'Full audit trail', 'Every edit is versioned; deletions are reversible; nothing is double counted.'],
            ].map(([Icon, title, body], i) => {
              const I = Icon as React.ElementType;
              return (
                <motion.div key={title as string} {...fadeUp} transition={{ ...fadeUp.transition, delay: (i % 3) * 0.06 }} className="rounded-2xl border border-border bg-surface p-6 shadow-card transition-all hover:-translate-y-1 hover:shadow-lift">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary"><I className="size-5" /></span>
                  <h3 className="mt-4 font-semibold">{title as string}</h3>
                  <p className="mt-1.5 text-sm text-fg-muted">{body as string}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="how" className="py-20">
        <div className="mx-auto max-w-6xl px-5">
          <motion.h2 {...fadeUp} className="text-3xl font-semibold sm:text-4xl">Three steps to even</motion.h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              ['1', 'Add an expense', 'Enter what was spent, who paid and how to split it. See everyone’s share before you save.'],
              ['2', 'Watch balances update', 'Owenil keeps a ledger of who owes whom, per currency, across every group.'],
              ['3', 'Settle up', 'Pay back however you like, then record it. Balances return to exactly zero.'],
            ].map(([n, t, b], i) => (
              <motion.div key={n} {...fadeUp} transition={{ ...fadeUp.transition, delay: i * 0.08 }} className="relative rounded-2xl border border-border bg-surface p-6">
                <span className="font-display text-5xl font-semibold text-primary/20">{n}</span>
                <h3 className="mt-2 text-lg font-semibold">{t}</h3>
                <p className="mt-1.5 text-sm text-fg-muted">{b}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="trust" className="border-y border-border bg-[hsl(226_45%_8%)] py-20 text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 lg:grid-cols-2">
          <motion.div {...fadeUp}>
            <Lock className="size-8 text-emerald-300" />
            <h2 className="mt-4 text-3xl font-semibold">Private by design</h2>
            <p className="mt-3 text-white/70">Your data is protected by database-level access rules: people only ever see the groups, friends and expenses they’re part of. Receipts are stored privately. Owenil never moves money and never asks for bank details.</p>
          </motion.div>
          <motion.ul {...fadeUp} className="grid gap-3 text-sm">
            {['Row-level security on every table', 'Every financial change is atomic, validated and auditable', 'Retried requests can never double-record a repayment', 'Export or delete your data any time'].map((t) => (
              <li key={t} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4"><Check className="size-4 text-emerald-300" /> {t}</li>
            ))}
          </motion.ul>
        </div>
      </section>

      <section className="py-20">
        <motion.div {...fadeUp} className="mx-auto max-w-3xl px-5 text-center">
          <h2 className="text-3xl font-semibold sm:text-4xl">Ready to stop doing mental maths?</h2>
          <p className="mt-3 text-fg-muted">Create a group in under a minute.</p>
          <Button size="lg" className="mt-8" asChild><Link to="/register">Get started — it’s free <ArrowRight /></Link></Button>
        </motion.div>
      </section>

      <footer className="border-t border-border py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 text-sm text-fg-muted sm:flex-row">
          <Logo />
          <p>© {new Date().getFullYear()} Owenil · Records shared expenses; never transfers money.</p>
        </div>
      </footer>
    </div>
  );
}

function HeroMock() {
  const people = [
    { n: 'Aarav', c: '#14b8a6', v: '+₹2,000', pos: true },
    { n: 'Meera', c: '#8b5cf6', v: '−₹1,000', pos: false },
    { n: 'Kabir', c: '#f97316', v: '−₹1,000', pos: false },
  ];
  return (
    <motion.div initial={{ opacity: 0, y: 30, rotate: -1 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ duration: 0.8, delay: 0.15, ease: [0.16, 1, 0.3, 1] }} className="relative mx-auto w-full max-w-md" aria-hidden>
      <div className="absolute -inset-6 rounded-[2rem] bg-brand-gradient opacity-20 blur-2xl" />
      <div className="relative rounded-3xl border border-border bg-surface p-5 shadow-lift">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-xl">🏖️</span>
          <div>
            <p className="font-semibold">Goa trip</p>
            <p className="text-xs text-fg-muted">3 members · INR</p>
          </div>
          <span className="ml-auto rounded-full bg-positive-soft px-2.5 py-1 text-xs font-medium text-positive">you get ₹2,000</span>
        </div>
        <div className="mt-5 rounded-2xl bg-muted/60 p-4">
          <p className="text-xs text-fg-muted">Beach villa · paid by Aarav</p>
          <p className="font-display text-2xl font-semibold">₹3,000.00</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-border">
            <motion.div className="h-full bg-brand-gradient" initial={{ width: 0 }} animate={{ width: '100%' }} transition={{ duration: 1.2, delay: 0.6, ease: [0.16, 1, 0.3, 1] }} />
          </div>
          <p className="mt-2 text-xs text-fg-muted">Split equally · ₹1,000 each</p>
        </div>
        <ul className="mt-4 space-y-2">
          {people.map((p, i) => (
            <motion.li key={p.n} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.8 + i * 0.12 }} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
              <Avatar name={p.n} color={p.c} size="sm" />
              <span className="flex-1 text-sm font-medium">{p.n}</span>
              <span className={`tabular text-sm font-semibold ${p.pos ? 'text-positive' : 'text-negative'}`}>{p.v}</span>
            </motion.li>
          ))}
        </ul>
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.3 }} className="absolute -bottom-5 -right-3 flex items-center gap-2 rounded-2xl border border-border bg-elevated px-4 py-3 shadow-lift sm:-right-8">
          <Sparkles className="size-4 text-primary" />
          <span className="text-sm"><strong>2</strong> repayments settle everyone</span>
        </motion.div>
      </div>
    </motion.div>
  );
}
