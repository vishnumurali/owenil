import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowDownLeft, ArrowRight, BarChart3, CalendarClock, Check, CheckCircle2, Coins, HandCoins, Home, IndianRupee, LayoutGrid, Lock, Moon, Plus,
  Receipt, Scale, ShieldCheck, Sparkles, Sun, Users,
} from 'lucide-react';
import { useDocumentTitle } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';

const fadeUp = { initial: { opacity: 0, y: 18 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-60px' }, transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] } };

const chip = {
  emerald: 'bg-[linear-gradient(135deg,hsl(var(--aurora-1)),hsl(var(--primary-2)))]',
  sky: 'bg-[linear-gradient(135deg,hsl(var(--aurora-2)),hsl(var(--accent)))]',
  violet: 'bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(330_80%_62%))]',
  amber: 'bg-[linear-gradient(135deg,hsl(38_95%_58%),hsl(18_90%_58%))]',
};

export default function LandingPage() {
  useDocumentTitle('');
  const { resolved, setTheme } = useTheme();
  return (
    <div className="aurora min-h-dvh overflow-x-hidden">
      <header className="safe-top sticky top-0 z-30 px-3 pt-3">
        <div className="glass mx-auto flex h-14 max-w-6xl items-center gap-3 rounded-full pl-4 pr-2">
          <Logo />
          <nav className="ml-6 hidden gap-1 text-sm font-medium text-fg-muted md:flex" aria-label="Sections">
            {[['#features', 'Features'], ['#how', 'How it works'], ['#trust', 'Security']].map(([href, label]) => (
              <a key={href} href={href} className="rounded-full px-3 py-1.5 transition-colors hover:bg-fg/[0.06] hover:text-fg">{label}</a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}>
              {resolved === 'dark' ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
            </Button>
            <Button variant="ghost" asChild className="hidden sm:inline-flex"><Link to="/login">Sign in</Link></Button>
            <Button asChild size="sm" className="h-10"><Link to="/register">Get started</Link></Button>
          </div>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="relative">
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-12 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
          <div>
            <motion.p {...fadeUp} className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold text-fg-muted">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              Free for everyday splitting
            </motion.p>
            <motion.h1 {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.05 }} className="mt-6 text-balance text-[2.6rem] font-bold leading-[1.02] tracking-[-0.045em] sm:text-7xl">
              Shared expenses.{' '}
              <span className="text-gradient">Clear balances.</span>{' '}
              Better together.
            </motion.h1>
            <motion.p {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.1 }} className="mt-6 max-w-xl text-lg leading-relaxed text-fg-muted">
              Owenil keeps a fair, exact tab for trips, flatmates, couples and families — so nobody has to do the maths or the awkward reminding.
            </motion.p>
            <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.15 }} className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" asChild><Link to="/register">Create your free account <ArrowRight /></Link></Button>
              <Button size="lg" variant="outline" asChild><Link to="/login">I have an account</Link></Button>
            </motion.div>
            <motion.ul {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.2 }} className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-fg-muted">
              {['Exact to the paisa', 'Any currency', 'Private by design'].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-4 text-primary" /> {t}</li>
              ))}
            </motion.ul>
          </div>
          <PhoneMock />
        </div>
      </section>

      {/* ---------- Features (bento) ---------- */}
      <section id="features" className="py-20">
        <div className="mx-auto max-w-6xl px-5">
          <motion.div {...fadeUp} className="max-w-2xl">
            <p className="text-sm font-semibold text-primary">Everything in one place</p>
            <h2 className="mt-2 text-4xl font-bold sm:text-5xl">Everything a shared wallet needs</h2>
            <p className="mt-4 text-lg text-fg-muted">From a quick chai split to a two-week trip with five currencies.</p>
          </motion.div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Bento className="sm:col-span-2 lg:row-span-2" tone={chip.emerald} icon={LayoutGrid} title="Groups & friends" body="Trips, homes, couples, families — or one-to-one with a friend. Invite with a private link, or find friends by email, phone or your contacts.">
              <div className="mt-6 flex items-center gap-3">
                <div className="flex -space-x-3">
                  {([['Aarav', '#14b8a6'], ['Meera', '#8b5cf6'], ['Kabir', '#f97316'], ['Zara', '#eab308']] as const).map(([n, c]) => (
                    <Avatar key={n} name={n} color={c} ring className="ring-surface" />
                  ))}
                </div>
                <span className="rounded-full bg-positive-soft px-3 py-1 text-xs font-semibold text-positive">Goa trip · 4 members</span>
              </div>
            </Bento>
            <Bento tone={chip.sky} icon={Scale} title="Six ways to split" body="Equally, exact amounts, percentages, shares, adjustments or itemised receipts." />
            <Bento tone={chip.violet} icon={IndianRupee} title="Pay with UPI" body="Settle in GPay, PhonePe or any UPI app, with the amount filled in." />
            <Bento tone={chip.amber} icon={HandCoins} title="Simplified settle-up" body="The fewest repayments to clear a group, without changing anyone’s total." />
            <Bento tone={chip.emerald} icon={Users} title="Multiple payers" body="Two people paid the hotel? Record exactly who put in what." />
            <Bento tone={chip.sky} icon={CalendarClock} title="Recurring bills" body="Rent and subscriptions added automatically on schedule." />
            <Bento tone={chip.violet} icon={BarChart3} title="Insights & budgets" body="Monthly trends, categories and budget alerts with Owenil Plus." />
            <Bento tone={chip.amber} icon={Coins} title="Multi-currency" body="Every expense keeps its currency. Conversions use rates you choose." />
            <Bento tone={chip.emerald} icon={Receipt} title="Receipts" body="Attach private receipt photos and assign items to people (Plus)." />
            <Bento className="sm:col-span-2 lg:col-span-1" tone={chip.sky} icon={ShieldCheck} title="Full audit trail" body="Every edit is versioned; deletions are reversible; nothing is double counted." />
          </div>
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section id="how" className="py-20">
        <div className="mx-auto max-w-6xl px-5">
          <motion.h2 {...fadeUp} className="text-4xl font-bold sm:text-5xl">Three steps to even</motion.h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              ['1', 'Add an expense', 'Enter what was spent, who paid and how to split it. See everyone’s share before you save.'],
              ['2', 'Watch balances update', 'Owenil keeps a ledger of who owes whom, per currency, across every group.'],
              ['3', 'Settle up', 'Pay back however you like, then record it. Balances return to exactly zero.'],
            ].map(([n, t, b], i) => (
              <motion.div key={n} {...fadeUp} transition={{ ...fadeUp.transition, delay: i * 0.08 }} className="tile relative overflow-hidden rounded-[28px] p-7">
                <span className="text-gradient font-display text-6xl font-bold leading-none">{n}</span>
                <h3 className="mt-4 text-xl font-semibold">{t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">{b}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Trust ---------- */}
      <section id="trust" className="px-3 py-10 sm:px-5">
        <div className="hero-card mx-auto grid max-w-6xl gap-10 rounded-[36px] px-6 py-14 sm:px-12 lg:grid-cols-2">
          <motion.div {...fadeUp}>
            <span className="hero-chip flex size-12 items-center justify-center rounded-2xl"><Lock className="size-6 text-emerald-200" /></span>
            <h2 className="mt-5 text-4xl font-bold">Private by design</h2>
            <p className="mt-4 leading-relaxed text-white/75">Your data is protected by database-level access rules: people only ever see the groups, friends and expenses they’re part of. Receipts are stored privately. Owenil never moves money and never asks for bank details.</p>
          </motion.div>
          <motion.ul {...fadeUp} className="grid gap-3 text-sm">
            {['Row-level security on every table', 'Every financial change is atomic, validated and auditable', 'Retried requests can never double-record a repayment', 'Export or delete your data any time'].map((t) => (
              <li key={t} className="hero-chip flex items-center gap-3 rounded-2xl p-4 font-medium"><Check className="size-4 shrink-0 text-emerald-200" /> {t}</li>
            ))}
          </motion.ul>
        </div>
      </section>

      {/* ---------- Call to action ---------- */}
      <section className="py-20">
        <motion.div {...fadeUp} className="mx-auto max-w-3xl px-5 text-center">
          <h2 className="text-4xl font-bold sm:text-5xl">Ready to stop doing mental maths?</h2>
          <p className="mt-4 text-lg text-fg-muted">Create a group in under a minute.</p>
          <Button size="lg" className="mt-8" asChild><Link to="/register">Get started — it’s free <ArrowRight /></Link></Button>
        </motion.div>
      </section>

      <footer className="px-3 pb-6">
        <div className="glass mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 rounded-[28px] px-6 py-5 text-sm text-fg-muted sm:flex-row">
          <Logo />
          <p>© {new Date().getFullYear()} Owenil · Records shared expenses; never transfers money.</p>
        </div>
      </footer>
    </div>
  );
}

function Bento({ title, body, icon: Icon, tone, className, children }: { title: string; body: string; icon: React.ElementType; tone: string; className?: string; children?: React.ReactNode }) {
  return (
    <motion.div {...fadeUp} className={cn('tile group rounded-[28px] p-6 transition-transform duration-300 hover:-translate-y-1', className)}>
      <span className={cn('flex size-11 items-center justify-center rounded-[14px] text-white shadow-sm', tone)}><Icon className="size-5" /></span>
      <h3 className="mt-5 text-lg font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{body}</p>
      {children}
    </motion.div>
  );
}

/** A phone showing the real app design: the balance card, recent expenses and the dock. */
function PhoneMock() {
  const rows = [
    { d: 'Beach villa', s: 'Aarav paid ₹3,000', v: '+₹2,000', pos: true, icon: Home, c: '#14b8a6' },
    { d: 'Seafood dinner', s: 'Meera paid ₹1,800', v: '−₹600', pos: false, icon: Receipt, c: '#8b5cf6' },
    { d: 'Scooter rental', s: 'Kabir paid ₹900', v: '−₹300', pos: false, icon: Sparkles, c: '#f97316' },
  ];
  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.15, ease: [0.16, 1, 0.3, 1] }} className="relative mx-auto w-full max-w-[330px]" aria-hidden>
      <div className="absolute -inset-10 rounded-full bg-orb-gradient opacity-25 blur-3xl" />
      <div className="glass relative rounded-[46px] p-2.5">
        <div className="aurora relative overflow-hidden rounded-[38px] px-4 pb-24 pt-4">
          <div className="flex items-center justify-between text-[10px] font-semibold text-fg-muted">
            <span>9:41</span>
            <span className="h-5 w-20 rounded-full bg-fg/90" />
            <span>100%</span>
          </div>
          <p className="mt-4 text-[11px] text-fg-muted">Good evening,</p>
          <p className="text-lg font-bold tracking-tight">Aarav Mehta</p>
          <div className="hero-card mt-3 rounded-[24px] p-4">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/70">Net balance</p>
            <p className="mt-1 font-display text-3xl font-bold tracking-[-0.04em]">+₹1,100</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="hero-chip rounded-2xl px-2.5 py-2">
                <p className="flex items-center gap-1 text-[9px] text-white/70"><ArrowDownLeft className="size-3" /> You are owed</p>
                <p className="text-sm font-bold">₹2,000</p>
              </div>
              <div className="hero-chip rounded-2xl px-2.5 py-2">
                <p className="text-[9px] text-white/70">You owe</p>
                <p className="text-sm font-bold">₹900</p>
              </div>
            </div>
          </div>
          <div className="tile mt-3 space-y-1 rounded-[22px] p-1.5">
            {rows.map((r, i) => (
              <motion.div key={r.d} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.7 + i * 0.12 }} className="flex items-center gap-2.5 rounded-2xl px-2 py-1.5">
                <span className="flex size-8 items-center justify-center rounded-[11px]" style={{ background: `${r.c}26`, color: r.c }}><r.icon className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">{r.d}</span>
                  <span className="block truncate text-[10px] text-fg-muted">{r.s}</span>
                </span>
                <span className={cn('tabular text-xs font-bold', r.pos ? 'text-positive' : 'text-negative')}>{r.v}</span>
              </motion.div>
            ))}
          </div>
          <div className="absolute inset-x-3 bottom-3 flex items-center gap-2">
            <div className="glass flex flex-1 items-center justify-around rounded-full p-1">
              <span className="bg-primary-gradient flex h-9 w-12 items-center justify-center rounded-full text-primary-fg"><Home className="size-4" /></span>
              <LayoutGrid className="size-4 text-fg-muted" />
              <Users className="size-4 text-fg-muted" />
            </div>
            <span className="bg-orb-gradient flex size-11 items-center justify-center rounded-full text-white shadow-glow-accent"><Plus className="size-5" /></span>
          </div>
        </div>
      </div>
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.2 }} className="glass absolute -bottom-5 -left-8 hidden items-center gap-2 rounded-2xl px-3.5 py-2.5 sm:flex">
        <CheckCircle2 className="size-4 text-positive" />
        <span className="text-xs font-semibold">Paid with UPI · marked paid</span>
      </motion.div>
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.4 }} className="glass absolute -right-3 -top-5 flex items-center gap-2 rounded-2xl px-3.5 py-2.5 sm:-right-10">
        <Sparkles className="size-4 text-accent" />
        <span className="text-xs font-semibold"><strong>2</strong> repayments settle everyone</span>
      </motion.div>
    </motion.div>
  );
}
