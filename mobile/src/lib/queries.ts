import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';

import { mockStore } from './mocks/store';
import { aggregate } from './spending';
import { supabase, USE_MOCKS } from './supabase';
import type { ProfileRow, ReclaimedCardRow, RoutingMode, TransactionRow, UserCardRow } from './types';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnReconnect: true, retry: 1, staleTime: 30_000 } },
});

// Refetch when the network comes back and when the app returns to the foreground (PRD F6).
onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((s) => setOnline(!!s.isConnected)));
AppState.addEventListener('change', (status) => focusManager.setFocused(status === 'active'));

export const keys = {
  profile: ['profile'] as const,
  cards: ['user-cards'] as const,
  reclaimedCard: ['reclaimed-card'] as const,
  transactions: ['transactions'] as const,
  transaction: (id: string) => ['transaction', id] as const,
};

async function must<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

export function useProfile() {
  return useQuery({
    queryKey: keys.profile,
    queryFn: () => (USE_MOCKS ? mockStore.profile() : must<ProfileRow>(supabase.from('profiles').select('*').single())),
  });
}

export function useUserCards() {
  return useQuery({
    queryKey: keys.cards,
    queryFn: () =>
      USE_MOCKS
        ? mockStore.cards()
        : must<UserCardRow[]>(supabase.from('user_cards').select('*, card_product:card_products(*)').order('priority')),
  });
}

export function useReclaimedCard() {
  return useQuery({
    queryKey: keys.reclaimedCard,
    queryFn: () =>
      USE_MOCKS ? mockStore.reclaimedCard() : must<ReclaimedCardRow | null>(supabase.from('reclaimed_cards').select('id, last4, state').maybeSingle()),
  });
}

export function useTransactions() {
  return useQuery({
    queryKey: keys.transactions,
    queryFn: () =>
      USE_MOCKS
        ? mockStore.transactions()
        : must<TransactionRow[]>(supabase.from('transactions').select('*').order('created_at', { ascending: false }).limit(200)),
  });
}

// Reads from the feed cache first so a Realtime row opens instantly.
export function useTransaction(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.transaction(id),
    initialData: () => qc.getQueryData<TransactionRow[]>(keys.transactions)?.find((t) => t.id === id),
    queryFn: () =>
      USE_MOCKS
        ? (mockStore.transactions().find((t) => t.id === id) ?? Promise.reject(new Error('Transaction not found')))
        : must<TransactionRow>(supabase.from('transactions').select('*').eq('id', id).single()),
  });
}

function useProfilePatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<ProfileRow>) => {
      if (USE_MOCKS) return mockStore.updateProfile(patch);
      const current = qc.getQueryData<ProfileRow>(keys.profile);
      return must<ProfileRow>(supabase.from('profiles').update(patch).eq('id', current?.id ?? '').select('*').single());
    },
    // Optimistic: the toggle flips instantly; roll back if the write fails.
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: keys.profile });
      const previous = qc.getQueryData<ProfileRow>(keys.profile);
      if (previous) qc.setQueryData(keys.profile, { ...previous, ...patch });
      return { previous };
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.profile, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.profile }),
  });
}

export function useSetMode() {
  const patch = useProfilePatch();
  return { ...patch, mutate: (mode: RoutingMode) => patch.mutate({ routing_mode: mode }) };
}

export function useSetManualCard() {
  const patch = useProfilePatch();
  return { ...patch, mutate: (cardId: string) => patch.mutate({ manual_card_id: cardId }) };
}

export function useSpending() {
  const txs = useTransactions();
  const cards = useUserCards();
  return {
    isLoading: txs.isLoading || cards.isLoading,
    error: txs.error ?? cards.error,
    refetch: () => Promise.all([txs.refetch(), cards.refetch()]),
    data: txs.data && cards.data ? aggregate(txs.data, cards.data) : undefined,
  };
}
