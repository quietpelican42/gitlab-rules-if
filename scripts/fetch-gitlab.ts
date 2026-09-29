// Fetches the GitLab source and spec files the live tests use into .cache/gitlab/.
// Every file is pinned to a commit SHA and checked against a sha256; a mismatch
// deletes nothing and fails loudly. Nothing fetched is committed (see .gitignore).
//
//   node scripts/fetch-gitlab.ts            # download what is missing
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE = process.env.GITLAB_CACHE ?? join(root, '.cache', 'gitlab');
const manifest = JSON.parse(readFileSync(join(root, 'scripts', 'gitlab-files.json'), 'utf8')) as {
  repo: string;
  ref: string;
  license: { path: string; sha256: string };
  files: Record<string, string>;
};

export const GITLAB_REF = manifest.ref;

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

/** Returns true when every pinned file is present and matches its hash. */
export function cacheComplete(): boolean {
  const all: [string, string][] = [[manifest.license.path, manifest.license.sha256], ...Object.entries(manifest.files)];
  return all.every(([p, h]) => existsSync(join(CACHE, p)) && sha256(readFileSync(join(CACHE, p))) === h);
}

export async function fetchAll(): Promise<void> {
  const all: [string, string][] = [[manifest.license.path, manifest.license.sha256], ...Object.entries(manifest.files)];
  for (const [p, hash] of all) {
    const dest = join(CACHE, p);
    if (existsSync(dest) && sha256(readFileSync(dest)) === hash) continue;
    const url = `https://raw.githubusercontent.com/${manifest.repo}/${manifest.ref}/${p}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha256(buf) !== hash) throw new Error(`sha256 mismatch for ${p} at ${manifest.ref}`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
  }
}

if (import.meta.main === true) {
  try {
    await fetchAll();
    console.log(`GitLab files are in ${CACHE} (${manifest.ref})`);
  } catch (e) {
    console.error(String(e));
    process.exit(2);
  }
}
