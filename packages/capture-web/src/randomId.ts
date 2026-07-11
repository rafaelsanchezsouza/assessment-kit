/**
 * RFC-4122 v4-shaped id, safe in insecure contexts.
 *
 * `crypto.randomUUID()` is only defined in **secure contexts** (HTTPS or
 * localhost). Served over plain HTTP it is `undefined`, so calling it throws —
 * which silently aborted step advancement in the capture flow. This prefers
 * `randomUUID`, falls back to `crypto.getRandomValues` (available over HTTP too),
 * and finally to `Math.random`. These ids are local queue keys / evidence
 * identifiers: uniqueness matters, cryptographic strength does not.
 */
export function randomId(): string {
  const c: Crypto | undefined = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}
