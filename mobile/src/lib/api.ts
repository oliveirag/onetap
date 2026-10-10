import { mockChat } from './mocks/chat';
import { mockStore } from './mocks/store';
import { supabase, USE_MOCKS } from './supabase';
import type { ChatRequest, ChatResponse, OneTapCardRow, UserCardRow } from './types';

const later = <T>(ms: number, f: () => T) => new Promise<T>((resolve) => setTimeout(() => resolve(f()), ms));

const API_URL = process.env.EXPO_PUBLIC_API_URL;

// Backend calls that need a secret on the server. The app only sends the user's session token.
async function post<T>(path: string, body: unknown): Promise<T> {
  if (!API_URL) throw new Error('Set EXPO_PUBLIC_API_URL, or EXPO_PUBLIC_USE_MOCKS=1.');
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  // Shared contract 4. Every number in the reply is computed by our backend; Claude only explains it.
  chat: (req: ChatRequest): Promise<ChatResponse> => (USE_MOCKS ? mockChat(req) : post<ChatResponse>('/chat', req)),
  // PRD F2 fallback: the backend creates the Plaid sandbox connection directly. Path is a
  // placeholder until Ehsan's backend lands on main; Plaid Link in the app comes with it.
  connectTestAccounts: (): Promise<UserCardRow[]> =>
    USE_MOCKS ? later(800, () => mockStore.connectTestAccounts()) : post<UserCardRow[]>('/plaid/sandbox-connect', {}),
  // Creates the Lithic sandbox virtual card. Same placeholder caveat as above.
  createOneTapCard: (): Promise<OneTapCardRow> =>
    USE_MOCKS ? later(900, () => mockStore.oneTapCard()) : post<OneTapCardRow>('/cards/onetap', {}),
};
