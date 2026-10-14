import { Suspense } from 'react';
import { lazyPage } from '@/lib/lazy-page';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { isSupabaseConfigured } from '@/lib/env';
import { useAuth } from '@/features/auth/AuthProvider';
import { useMe } from '@/data/queries';
import { AppShell } from '@/components/layout/AppShell';
import { FullPageSpinner, SetupRequired } from '@/components/layout/Splash';
import { safeNextPath } from '@/lib/utils';

const Landing = lazyPage(() => import('@/features/landing/LandingPage'));
const AuthPages = lazyPage(() => import('@/features/auth/AuthPages'));
const Onboarding = lazyPage(() => import('@/features/onboarding/OnboardingPage'));
const Dashboard = lazyPage(() => import('@/features/dashboard/DashboardPage'));
const GroupsPage = lazyPage(() => import('@/features/groups/GroupsPage'));
const GroupDetail = lazyPage(() => import('@/features/groups/GroupDetailPage'));
const GroupForm = lazyPage(() => import('@/features/groups/GroupFormPage'));
const JoinPage = lazyPage(() => import('@/features/groups/JoinPage'));
const FriendsPage = lazyPage(() => import('@/features/friends/FriendsPage'));
const FriendDetail = lazyPage(() => import('@/features/friends/FriendDetailPage'));
const ExpensesPage = lazyPage(() => import('@/features/expenses/ExpensesPage'));
const ExpenseFormPage = lazyPage(() => import('@/features/expenses/ExpenseFormPage'));
const ExpenseDetail = lazyPage(() => import('@/features/expenses/ExpenseDetailPage'));
const BalancesPage = lazyPage(() => import('@/features/balances/BalancesPage'));
const SettlementsPage = lazyPage(() => import('@/features/balances/SettlementsPage'));
const RecurringPage = lazyPage(() => import('@/features/recurring/RecurringPage'));
const AnalyticsPage = lazyPage(() => import('@/features/analytics/AnalyticsPage'));
const BudgetsPage = lazyPage(() => import('@/features/budgets/BudgetsPage'));
const NotificationsPage = lazyPage(() => import('@/features/notifications/NotificationsPage'));
const PlusPage = lazyPage(() => import('@/features/premium/PlusPage'));
const SettingsPage = lazyPage(() => import('@/features/settings/SettingsPage'));
const CurrencyPage = lazyPage(() => import('@/features/settings/CurrencyPage'));
const PrivacyPage = lazyPage(() => import('@/features/settings/PrivacyPage'));
const ExportPage = lazyPage(() => import('@/features/settings/ExportPage'));
const HelpPage = lazyPage(() => import('@/features/help/HelpPage'));
const NotFound = lazyPage(() => import('@/features/misc/NotFoundPage'));

function RequireAuth({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  const me = useMe();
  if (loading) return <FullPageSpinner />;
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (me.isLoading) return <FullPageSpinner />;
  if (me.data && !me.data.profile.onboarded_at && location.pathname !== '/onboarding' && !location.pathname.startsWith('/join/')) {
    return <Navigate to={`/onboarding?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return children;
}

function PublicOnly({ children }: { children: JSX.Element }) {
  const { session, loading, recovery } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (session && !recovery && location.pathname !== '/reset-password') {
    const next = new URLSearchParams(location.search).get('next');
    return <Navigate to={safeNextPath(next)} replace />;
  }
  return children;
}

export function App() {
  if (!isSupabaseConfigured) return <SetupRequired />;
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/" element={<LandingOrApp />} />
        <Route path="/login" element={<PublicOnly><AuthPages mode="login" /></PublicOnly>} />
        <Route path="/register" element={<PublicOnly><AuthPages mode="register" /></PublicOnly>} />
        <Route path="/forgot-password" element={<PublicOnly><AuthPages mode="forgot" /></PublicOnly>} />
        <Route path="/reset-password" element={<AuthPages mode="reset" />} />
        <Route path="/auth/callback" element={<AuthPages mode="callback" />} />
        <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/groups/new" element={<GroupForm />} />
          <Route path="/groups/:groupId" element={<GroupDetail />} />
          <Route path="/groups/:groupId/edit" element={<GroupForm />} />
          <Route path="/join/:kind/:token" element={<JoinPage />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/friends/:friendId" element={<FriendDetail />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/expenses/new" element={<ExpenseFormPage />} />
          <Route path="/expenses/:expenseId" element={<ExpenseDetail />} />
          <Route path="/expenses/:expenseId/edit" element={<ExpenseFormPage />} />
          <Route path="/balances" element={<BalancesPage />} />
          <Route path="/settlements" element={<SettlementsPage />} />
          <Route path="/recurring" element={<RecurringPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/budgets" element={<BudgetsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/plus" element={<PlusPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/currency" element={<CurrencyPage />} />
          <Route path="/settings/privacy" element={<PrivacyPage />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

function LandingOrApp() {
  const { session, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  return session ? <Navigate to="/dashboard" replace /> : <Landing />;
}
