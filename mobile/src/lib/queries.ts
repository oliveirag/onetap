import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';

import { api } from './api';
import { authBackend } from './auth';
import { live } from './backend';
import { mockStore } from './mocks/store';
import { aggregate } from './spending';
import { USE_MOCKS } from './supabase';
import type { ProfileRow, RoutingMode, TransactionRow, UserCardRow } from './types';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnReconnect: true, retry: 1, staleTime: 30_000 } },
});

// Refetch when the network comes back and when the app returns to the foreground (PRD F6).
onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((s) => setOnline(!!s.isConnected)));
AppState.addEventListener('change', (status) => focusManager.setFocused(status === 'active'));

export const keys = {
  profile: ['profile'] as const,
  cards: ['user-cards'] as const,
  oneTapCard: ['onetap-card'] as const,
  rates: ['card-rates'] as const,
  transactions: ['transactions'] as const,
  transaction: (id: string) => ['transaction', id] as const,
};

export function useProfile() {
  return useQuery({
    queryKey: keys.profile,
    queryFn: () => (USE_MOCKS ? mockStore.profile() : live.profile()),
  });
}

export function useUserCards() {
  return useQuery({
    queryKey: keys.cards,
    queryFn: () => (USE_MOCKS ? mockStore.cards() : live.userCards()),
  });
}

// Reference data (read-only to the app). Its own query, so the routing rules can fail on their own
// without taking the card list down with them.
export function useCardRates() {
  return useQuery({
    queryKey: keys.rates,
    staleTime: Infinity,
    queryFn: () => (USE_MOCKS ? mockStore.rates() : live.rates()),
  });
}

export function useOneTapCard() {
  return useQuery({
    queryKey: keys.oneTapCard,
    queryFn: () => (USE_MOCKS ? mockStore.oneTapCard() : live.oneTapCard()),
  });
}

export function useTransactions() {
  return useQuery({
    queryKey: keys.transactions,
    queryFn: () => (USE_MOCKS ? mockStore.transactions() : live.transactions()),
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
        : live.transaction(id),
  });
}

function useProfilePatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<ProfileRow>) => {
      if (USE_MOCKS) return mockStore.updateProfile(patch);
      const current = qc.getQueryData<ProfileRow>(keys.profile);
      return live.updateProfile(current?.id ?? '', patch);
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

export function useSetDefaultCard() {
  const patch = useProfilePatch();
  return { ...patch, mutate: (cardId: string) => patch.mutate({ default_card_id: cardId }) };
}

// Saves a new card order as priorities 1..n. Optimistic, so the list never jumps back mid-drop.
export function useReorderCards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (order: string[]) => {
      if (USE_MOCKS) return mockStore.setCardOrder(order);
      return live.setCardOrder(order);
    },
    onMutate: async (order) => {
      await qc.cancelQueries({ queryKey: keys.cards });
      const previous = qc.getQueryData<UserCardRow[]>(keys.cards);
      if (previous) {
        const byId = new Map(previous.map((c) => [c.id, c]));
        qc.setQueryData(
          keys.cards,
          order.map((id, i) => ({ ...byId.get(id)!, priority: i + 1 })),
        );
      }
      return { previous };
    },
    onError: (_e, _order, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.cards, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.cards }),
  });
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

export function useConnectCards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.connectCards,
    onSuccess: (cards) => qc.setQueryData(keys.cards, cards),
  });
}

// Changes which catalog product a connected account is (PRD F2 match step).
export function useSetCardProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ cardId, productId }: { cardId: string; productId: string }) => {
      if (USE_MOCKS) return mockStore.setCardProduct(cardId, productId);
      return live.setCardProduct(cardId, productId);
    },
    onSuccess: (card) => qc.setQueryData<UserCardRow[]>(keys.cards, (old = []) => old.map((c) => (c.id === card.id ? card : c))),
  });
}

export function useCreateOneTapCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createOneTapCard,
    onSuccess: (card) => qc.setQueryData(keys.oneTapCard, card),
  });
}

// Ends the session and drops every cached user row. The root gate sees no session and shows Welcome.
export async function signOut() {
  await authBackend.signOut();
  queryClient.clear();
}
