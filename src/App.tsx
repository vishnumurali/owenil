import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { isSupabaseConfigured } from '@/lib/env';
import { useAuth } from '@/features/auth/AuthProvider';
import { useMe } from '@/data/queries';
import { AppShell } from '@/components/layout/AppShell';
import { FullPageSpinner, SetupRequired } from '@/components/layout/Splash';
import { safeNextPath } from '@/lib/utils';

const Landing = lazy(() => import('@/features/landing/LandingPage'));
const AuthPages = lazy(() => import('@/features/auth/AuthPages'));
const Onboarding = lazy(() => import('@/features/onboarding/OnboardingPage'));
const Dashboard = lazy(() => import('@/features/dashboard/DashboardPage'));
const GroupsPage = lazy(() => import('@/features/groups/GroupsPage'));
const GroupDetail = lazy(() => import('@/features/groups/GroupDetailPage'));
const GroupForm = lazy(() => import('@/features/groups/GroupFormPage'));
const JoinPage = lazy(() => import('@/features/groups/JoinPage'));
const FriendsPage = lazy(() => import('@/features/friends/FriendsPage'));
const FriendDetail = lazy(() => import('@/features/friends/FriendDetailPage'));
const ExpensesPage = lazy(() => import('@/features/expenses/ExpensesPage'));
const ExpenseFormPage = lazy(() => import('@/features/expenses/ExpenseFormPage'));
const ExpenseDetail = lazy(() => import('@/features/expenses/ExpenseDetailPage'));
const BalancesPage = lazy(() => import('@/features/balances/BalancesPage'));
const SettlementsPage = lazy(() => import('@/features/balances/SettlementsPage'));
const RecurringPage = lazy(() => import('@/features/recurring/RecurringPage'));
const AnalyticsPage = lazy(() => import('@/features/analytics/AnalyticsPage'));
const BudgetsPage = lazy(() => import('@/features/budgets/BudgetsPage'));
const NotificationsPage = lazy(() => import('@/features/notifications/NotificationsPage'));
const PlusPage = lazy(() => import('@/features/premium/PlusPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const CurrencyPage = lazy(() => import('@/features/settings/CurrencyPage'));
const PrivacyPage = lazy(() => import('@/features/settings/PrivacyPage'));
const ExportPage = lazy(() => import('@/features/settings/ExportPage'));
const HelpPage = lazy(() => import('@/features/help/HelpPage'));
const NotFound = lazy(() => import('@/features/misc/NotFoundPage'));

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
