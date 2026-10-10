import { createPlaidLinkSession, type LinkExit, type LinkSuccess } from 'react-native-plaid-link-sdk';

export type PlaidLinkResult =
  | { kind: 'success'; publicToken: string; institution?: { id?: string; name?: string } }
  | { kind: 'exit'; message?: string };

/**
 * Opens Plaid Link (react-native-plaid-link-sdk v13 session API). Requires an Expo
 * development build — Plaid's native SDK is not available in Expo Go.
 */
export function openPlaidLink(linkToken: string): Promise<PlaidLinkResult> {
  return new Promise((resolve, reject) => {
    createPlaidLinkSession({
      token: linkToken,
      onSuccess: (s: LinkSuccess) =>
        resolve({ kind: 'success', publicToken: s.publicToken, institution: s.metadata.institution ? { id: s.metadata.institution.id, name: s.metadata.institution.name } : undefined }),
      onExit: (e: LinkExit) => resolve({ kind: 'exit', message: e.error?.displayMessage ?? e.error?.errorMessage ?? undefined }),
      onEvent: () => undefined,
    })
      .then((session) => session.open(false))
      .catch(reject);
  });
}
