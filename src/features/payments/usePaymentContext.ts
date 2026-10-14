import * as React from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBalanceOverview, useGroups, useMyItemPayments } from '@/data/queries';
import { deriveMyEdges, groupNetsFromRows } from '@/data/balances';
import type { PaymentContext } from '@/data/payments';

/** Balances, groups and per-expense payments combined for working out what to pay. */
export function usePaymentContext(): PaymentContext | null {
  const { user } = useAuth();
  const balances = useBalanceOverview();
  const groups = useGroups();
  const paid = useMyItemPayments();
  return React.useMemo(() => {
    if (!user || !balances.data || !groups.data || !paid.data) return null;
    return {
      me: user.id,
      edges: deriveMyEdges(balances.data, groups.data, user.id),
      groupNets: groupNetsFromRows(balances.data),
      simplify: new Map(groups.data.map((g) => [g.id, g.simplify_debts])),
      itemPaid: paid.data,
    };
  }, [user, balances.data, groups.data, paid.data]);
}
