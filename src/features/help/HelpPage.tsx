import { Link } from 'react-router-dom';
import { ChevronDown, Mail } from 'lucide-react';
import { useDocumentTitle } from '@/lib/hooks';
import { Card } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { PageHeader, SectionTitle } from '@/components/ui/layout-bits';

const FAQ: [string, React.ReactNode][] = [
  ['Does Owenil move money?', 'No. Owenil records who paid and who owes. Pay each other with your bank, UPI or cash, then record the repayment so balances update.'],
  ['How are shares rounded?', 'All amounts are stored in the smallest unit of the currency (paise, cents). When something can’t be split evenly, leftover paise go to specific people in a fixed order, so shares always add up exactly to the total.'],
  ['What does “simplify debts” do?', 'It suggests the fewest repayments that settle a group. Each person’s overall balance stays exactly the same — only the route changes. Suggestions are never recorded as payments.'],
  ['What happens when I edit an expense?', 'The old amounts are reversed and the new ones applied in a single step, so nothing is counted twice. Every version is kept in the expense’s history.'],
  ['Can I delete an expense by mistake?', 'Deleted expenses can be restored from the expense page (use “Show deleted” in Expenses to find them).'],
  ['Can I mix currencies?', 'Yes — each expense keeps its own currency, and balances are shown per currency. Owenil never adds different currencies together unless you choose to convert them with a rate you recorded (Plus).'],
  ['How do recurring expenses work?', 'They’re generated on the server every hour, in the creator’s time zone, even if nobody has the app open. Each date is created at most once.'],
  ['Who can see my expenses?', 'Group expenses are visible to current group members. Non-group expenses are visible only to the people on them. This is enforced by the database, not just the app.'],
  ['Why can’t I leave a group?', 'You need a zero balance in the group first, so others aren’t left with an unpayable debt. Owners must make someone else the owner before leaving.'],
  ['Is this the real Owenil Plus?', 'Payments are not enabled yet. In test environments, a tester account can switch Plus on to try the features.'],
];

export default function HelpPage() {
  useDocumentTitle('Help');
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader title="Help & support" description="Answers to common questions about splitting and balances." />
      <section>
        <SectionTitle>Frequently asked</SectionTitle>
        <Card className="divide-y divide-border">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group p-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {q}
                <ChevronDown className="size-4 shrink-0 text-fg-subtle transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-2 text-sm text-fg-muted">{a}</p>
            </details>
          ))}
        </Card>
      </section>
      <section>
        <SectionTitle>Keyboard shortcuts</SectionTitle>
        <Card className="grid gap-3 p-4 text-sm sm:grid-cols-2">
          <p className="flex items-center justify-between">Add an expense <Kbd>N</Kbd></p>
          <p className="flex items-center justify-between">Search expenses <Kbd>/</Kbd></p>
        </Card>
      </section>
      <section>
        <SectionTitle>Still stuck?</SectionTitle>
        <Card className="flex flex-col gap-3 p-5 text-sm sm:flex-row sm:items-center">
          <Mail className="size-5 text-primary" />
          <p className="flex-1 text-fg-muted">Report a problem or suggest an idea on GitHub. You can also review the <Link to="/settings/privacy" className="font-medium text-primary hover:underline">privacy controls</Link> or export your data at any time.</p>
          <a href="https://github.com/vishnumurali/owenil/issues" className="font-medium text-primary hover:underline">Open an issue</a>
        </Card>
      </section>
    </div>
  );
}
