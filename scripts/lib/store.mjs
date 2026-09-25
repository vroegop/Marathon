// Read/write helpers for the data/ folder shared by the sync and ingest scripts.
import fs from 'node:fs/promises';
import path from 'node:path';

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

export async function writeJson(file, value, { pretty = false } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, (pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)) + '\n');
}

/** Index file: one activity per line so git diffs stay readable. */
export async function writeIndex(file, activities) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const lines = activities.map((a) => '  ' + JSON.stringify(a));
  await fs.writeFile(file, '[\n' + lines.join(',\n') + '\n]\n');
}

export const byStartDesc = (a, b) => (a.start_date < b.start_date ? 1 : a.start_date > b.start_date ? -1 : 0);

export function dataPaths(dataDir) {
  return {
    index: path.join(dataDir, 'activities.json'),
    state: path.join(dataDir, 'sync-state.json'),
    detail: (id) => path.join(dataDir, 'activities', `${id}.json`),
    streams: (id) => path.join(dataDir, 'streams', `${id}.json`),
  };
}
