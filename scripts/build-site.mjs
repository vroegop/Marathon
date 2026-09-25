#!/usr/bin/env node
// Assemble the static site: site/ -> _site/, data/ -> _site/data/.
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, '_site');

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
await fs.cp(path.join(ROOT, 'site'), OUT, { recursive: true });
try {
  await fs.cp(path.join(ROOT, 'data'), path.join(OUT, 'data'), { recursive: true });
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
  await fs.mkdir(path.join(OUT, 'data'), { recursive: true });
  await fs.writeFile(path.join(OUT, 'data', 'activities.json'), '[]\n');
}
await fs.writeFile(path.join(OUT, '.nojekyll'), '');
const count = (await fs.readdir(path.join(OUT, 'data'), { recursive: true })).length;
console.log(`Built _site/ (${count} data files).`);
