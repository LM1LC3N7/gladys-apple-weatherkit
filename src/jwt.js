// -----------------------------------------------------------------------------
// The WeatherKit token: a JWT signed ES256 with the private key (.p8) of the
// user's Apple Developer team. Built with node:crypto, no dependency. The key
// never leaves this process except as signatures.
// -----------------------------------------------------------------------------

import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';

const MAX_KEY_TEXT = 4096;

/**
 * Read the private key pasted in the configuration: the .p8 file as is, on
 * one line, with literal "\n", or the base64 body only. Returns a KeyObject
 * (EC P-256), or null; the text is never echoed.
 */
export function parsePrivateKey(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_KEY_TEXT) return null;
  const body = text
    .replace(/\\n/g, '\n')
    .replace(/-----(BEGIN|END) [A-Z ]{1,40}-----/g, '')
    .replace(/\s+/g, '');
  if (body.length < 40 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null;
  const der = Buffer.from(body, 'base64');
  for (const type of ['pkcs8', 'sec1']) {
    try {
      const key = createPrivateKey({ key: der, format: 'der', type });
      if (key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1') {
        return key;
      }
      return null;
    } catch {
      // try the next encoding
    }
  }
  return null;
}

/** SHA-256 of the PUBLIC key (SPKI): identifies the key, reveals nothing. */
export function publicKeyHash(key) {
  const spki = createPublicKey(key).export({ format: 'der', type: 'spki' });
  return createHash('sha256').update(spki).digest('hex');
}

const b64url = (data) => Buffer.from(data).toString('base64url');

/** Sign a WeatherKit token at `nowSeconds` (wall clock: Apple checks it). */
export function signToken({ teamId, keyId, serviceId, key }, nowSeconds, lifetime) {
  const header = { alg: 'ES256', kid: keyId, id: `${teamId}.${serviceId}` };
  const payload = { iss: teamId, iat: nowSeconds, exp: nowSeconds + lifetime, sub: serviceId };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${b64url(signature)}`;
}
