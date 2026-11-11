// -----------------------------------------------------------------------------
// The only place that talks to the network: one GET with a timeout, no
// redirect (the token would follow it), the body cut at a size limit before
// it is read whole. The tests replace fetch with `setFetch()`.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_BODY_BYTES, USER_AGENT } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

/** A network failure: no answer, timeout, body too large. Never a refusal. */
export class NetworkError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'NetworkError';
  }
}

async function readCapped(response, limit) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => {});
    throw new NetworkError('answer too large');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new NetworkError('answer too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * GET `url` with the bearer `token`. Resolves `{ status, text, date,
 * retryAfter }` for any HTTP status; rejects with a NetworkError when no
 * complete answer arrived. Neither the URL (it holds the coordinates) nor
 * the token appear in the error.
 */
export async function get(url, token, { timeout = HTTP_TIMEOUT, limit = MAX_BODY_BYTES } = {}) {
  const signal = AbortSignal.timeout(Math.max(1, timeout));
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      redirect: 'manual',
      signal,
    });
  } catch (err) {
    throw new NetworkError(err?.name === 'TimeoutError' ? 'timeout' : 'no answer');
  }
  let text;
  try {
    text = await readCapped(response, limit);
  } catch (err) {
    if (err instanceof NetworkError) throw err;
    throw new NetworkError(err?.name === 'TimeoutError' ? 'timeout' : 'answer cut');
  }
  return {
    status: response.status,
    text,
    date: response.headers.get('date'),
    retryAfter: response.headers.get('retry-after'),
  };
}
