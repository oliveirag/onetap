import { live } from './backend';
import { mockChat } from './mocks/chat';
import { mockStore } from './mocks/store';
import { supabase, USE_MOCKS } from './supabase';
import type { ChatRequest, ChatResponse, OneTapCardRow, UserCardRow } from './types';

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
async function post<T>(path: string, body: unknown): Promise<T> {
  if (!API_URL) throw new Error('Set EXPO_PUBLIC_API_URL, or EXPO_PUBLIC_USE_MOCKS=1.');
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`${API_URL.replace(/\/+$/, '')}/api/v1${path}`, {
    method: 'POST',
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

/** The backend's message when it has one written for people; otherwise null (use the screen's own copy). */
export const apiMessage = (e: unknown) => (e instanceof ApiError ? e.message : null);

export const api = {
  // Shared contract 4. Every number in the reply is computed by our backend; Claude only explains it.
  chat: (req: ChatRequest): Promise<ChatResponse> => (USE_MOCKS ? mockChat(req) : post<ChatResponse>('/chat', req)),
  // PRD F2 fallback: the backend links a Plaid Sandbox test user (no Plaid Link screen), then the
  // app reads the connected cards like any other time.
  connectTestAccounts: async (): Promise<UserCardRow[]> => {
    if (USE_MOCKS) return later(800, () => mockStore.connectTestAccounts());
    await post<{ cardIds: string[] }>('/onetap/connect-test-accounts', {});
    return live.userCards();
  },
  // Links the physical OneTap card: the backend waits for it to be tapped on the store reader.
  createOneTapCard: (): Promise<OneTapCardRow> => (USE_MOCKS ? later(900, () => mockStore.oneTapCard()) : post<OneTapCardRow>('/onetap/card', {})),
};
