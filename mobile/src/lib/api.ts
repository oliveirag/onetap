import { live, toOneTapCard } from './backend';
import { mockStore } from './mocks/store';
import { LinkFailed, openPlaidLink } from './plaid';
import { Platform } from 'react-native';

import { supabase, USE_MOCKS } from './supabase';
import type { OneTapCardRow, UserCardRow } from './types';

const later = <T>(ms: number, f: () => T) => new Promise<T>((resolve) => setTimeout(() => resolve(f()), ms));

const API_URL = process.env.EXPO_PUBLIC_API_URL;

// A backend error whose message is written for people (apps/api error envelope).
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

type Envelope<T> = { success: true; data: T } | { success: false; error: { code: string; message: string; retryable?: boolean } };

// Backend calls that need a secret on the server. The app only sends the user's session token.
async function send<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> {
  if (!API_URL) throw new Error('Set EXPO_PUBLIC_API_URL, or EXPO_PUBLIC_USE_MOCKS=1.');
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`${API_URL.replace(/\/+$/, '')}/api/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (json?.success) return json.data;
  if (json && !json.success) throw new ApiError(json.error.message, json.error.code, json.error.retryable ?? false);
  throw new Error(`${path} failed with ${res.status}`);
}

const post = <T>(path: string, body: unknown) => send<T>('POST', path, body);

/** The backend's message when it has one written for people; otherwise null (use the screen's own copy). */
export const apiMessage = (e: unknown) => (e instanceof ApiError || e instanceof LinkFailed ? e.message : null);

export const api = {
  // PRD F2: Plaid Link -> the backend exchanges the token and imports the accounts -> each credit
  // account becomes a routable card. Throws LinkCanceled if the user closes Link.
  connectCards: async (): Promise<UserCardRow[]> => {
    if (USE_MOCKS) return later(800, () => mockStore.connectTestAccounts());
    const { linkToken } = await post<{ linkToken: string }>('/plaid/link-token', { platform: Platform.OS === 'android' ? 'android' : 'ios' });
    const linked = await openPlaidLink(linkToken);
    await post('/plaid/exchange-token', { publicToken: linked.publicToken, institution: linked.institution ?? undefined });
    await post<{ cardIds: string[] }>('/onetap/connect-cards', {});
    return live.userCards();
  },
  // The OneTap card: the backend creates it digital at once.
  createOneTapCard: (): Promise<OneTapCardRow> => (USE_MOCKS ? later(900, () => mockStore.oneTapCard()) : post<OneTapCardRow>('/onetap/card', {})),
  // Attaches the physical card to it: the backend waits for the card to be tapped on the reader.
  linkPhysicalCard: (): Promise<OneTapCardRow> =>
    USE_MOCKS ? later(900, () => mockStore.linkPhysicalCard()) : post<OneTapCardRow>('/onetap/card/physical', {}),
  // Freeze (PRD F15): the backend declines every tap on a frozen card; the terminal shows it.
  setCardFrozen: async (card: OneTapCardRow, frozen: boolean): Promise<OneTapCardRow> => {
    if (USE_MOCKS) return later(300, () => mockStore.setCardFrozen(frozen));
    const dto = await send<{ id: string; displayId: string; status: string; uidMasked: string | null }>('PATCH', `/reclaimed-cards/${card.id}/status`, {
      status: frozen ? 'FROZEN' : 'ACTIVE',
    });
    return { ...card, ...toOneTapCard({ id: dto.id, display_id: dto.displayId, status: dto.status, uid_masked: dto.uidMasked }) };
  },
};
