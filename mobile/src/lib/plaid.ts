// Plaid Link (PRD F2): the user signs in to their bank inside Plaid's sheet; we get a one-time
// public token that only the backend can exchange. Loaded lazily so tests and mock mode never touch
// the native module.

export type LinkResult = { publicToken: string; institution: { id: string; name: string } | null };

// The user closed Link without connecting. Not an error to show.
export class LinkCanceled extends Error {
  constructor() {
    super('Plaid Link was closed');
  }
}

// Plaid reported an error; its message is written for people.
export class LinkFailed extends Error {}

export async function openPlaidLink(linkToken: string): Promise<LinkResult> {
  const { createPlaidLinkSession } = await import('react-native-plaid-link-sdk');
  return new Promise<LinkResult>((resolve, reject) => {
    createPlaidLinkSession({
      token: linkToken,
      onSuccess: (s) => resolve({ publicToken: s.publicToken, institution: s.metadata.institution ?? null }),
      onExit: (e) => reject(e.error ? new LinkFailed(e.error.displayMessage || "Your bank didn't connect. Try again.") : new LinkCanceled()),
      onEvent: () => {},
    })
      .then((session) => session.open())
      .catch(reject);
  });
}
