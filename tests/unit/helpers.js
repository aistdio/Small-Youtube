import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const read = name => fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', name), 'utf8');
export const load = name => JSON.parse(read(name));

// A fake clock for code that takes `now` and `sleep`.
export function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: ms => { t += ms; },
    sleep: async ms => { t += ms; },
  };
}

// An in-memory stand-in for chrome.storage.local and its change events.
export function fakeChrome() {
  const data = {};
  const listeners = [];
  return {
    runtime: { id: 'test' },
    storage: {
      local: {
        get: async keys => {
          if (keys == null) return { ...data };
          const out = {};
          for (const k of [].concat(keys)) if (k in data) out[k] = data[k];
          return out;
        },
        set: async patch => {
          const changes = {};
          for (const [k, v] of Object.entries(patch)) { changes[k] = { newValue: v, oldValue: data[k] }; data[k] = v; }
          for (const fn of listeners) fn(changes, 'local');
        },
      },
      onChanged: { addListener: fn => listeners.push(fn) },
    },
  };
}
