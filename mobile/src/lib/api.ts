import { mockChat } from './mocks/chat';
import { supabase, USE_MOCKS } from './supabase';
import type { ChatRequest, ChatResponse } from './types';

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
};
