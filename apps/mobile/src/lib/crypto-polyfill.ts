import * as ExpoCrypto from 'expo-crypto';

// React Native has no WebCrypto. Without it, supabase-js generates the PKCE verifier with
// Math.random() and sends it as a `plain` challenge. Back the two calls it needs with the
// platform's native CSPRNG and SHA-256 so it uses a secure verifier and the `S256` method.
type WebCryptoShim = { getRandomValues?: Crypto['getRandomValues']; subtle?: SubtleCrypto };
const g = globalThis as { crypto?: WebCryptoShim };
const webCrypto = (g.crypto ??= {});

if (typeof webCrypto.getRandomValues !== 'function') {
  webCrypto.getRandomValues = ExpoCrypto.getRandomValues as Crypto['getRandomValues'];
}

if (typeof webCrypto.subtle === 'undefined') {
  const digest = async (algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> => {
    const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
    if (name.toUpperCase() !== 'SHA-256') throw new Error(`crypto.subtle.digest: unsupported algorithm ${name}`);
    return ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, data);
  };
  // Only digest is provided; other SubtleCrypto methods are intentionally absent.
  webCrypto.subtle = { digest } as unknown as SubtleCrypto;
}
