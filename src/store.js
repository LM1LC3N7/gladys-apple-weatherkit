// -----------------------------------------------------------------------------
// /data/state.json: the monthly call count, the pause, the refused
// credentials (a salted hash), the last answers (no coordinates, no secret).
// A missing file is an empty state; an unreadable one is NOT (the caller
// retries). Writes go through one queue, atomically (temporary file + rename).
// -----------------------------------------------------------------------------

import { promises as fsPromises } from 'node:fs';
import { join } from 'node:path';

const MAX_FILE = 2_000_000;

export class UnreadableStateError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'UnreadableStateError';
  }
}

export class Store {
  constructor({ dir = '/data', fs = fsPromises } = {}) {
    this.fs = fs;
    this.file = join(dir, 'state.json');
    this.queue = Promise.resolve();
  }

  /** Resolves the saved object, `{}` when there is no file yet. */
  async read() {
    let text;
    try {
      text = await this.fs.readFile(this.file, 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT') return {};
      throw new UnreadableStateError(err?.code ?? 'read error');
    }
    if (text.length > MAX_FILE) throw new UnreadableStateError('too large');
    try {
      const value = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('not an object');
      }
      return value;
    } catch {
      throw new UnreadableStateError('not JSON');
    }
  }

  /** Queue a write of `value` (serialized now); resolves when it is on disk. */
  save(value) {
    const text = JSON.stringify(value);
    const run = async () => {
      const tmp = `${this.file}.tmp`;
      await this.fs.writeFile(tmp, text, { mode: 0o600 });
      await this.fs.rename(tmp, this.file);
    };
    const done = this.queue.then(run, run);
    this.queue = done.catch(() => {});
    return done;
  }

  /** Resolves once every queued write ended. */
  flush() {
    return this.queue;
  }
}
