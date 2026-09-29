// Runs a fresh corpus through GitLab's Ruby code (pinned files, sha256-checked) and compares.
// Needs: ruby, network access once (scripts/fetch-gitlab.ts). With a Python that has the
// `google-re2` wheel (RE2_PYTHON, or python3) regexes run in real RE2; otherwise Ruby's
// Regexp stands in and only rows marked `safe` are compared.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateCorpus, INPUTS, VARS } from '../scripts/gen-corpus.ts';
import { cacheComplete, CACHE, fetchAll } from '../scripts/fetch-gitlab.ts';
import type { OracleResult } from './oracle-compare.ts';
import { compareRow, knownResidual } from './oracle-compare.ts';

const root = join(import.meta.dirname, '..');
let skip: string | false = false;
const ruby = spawnSync('ruby', ['-e', 'print RUBY_VERSION'], { encoding: 'utf8', timeout: 20_000 });
if (ruby.status !== 0) skip = 'ruby is not installed';
else {
  try {
    if (!cacheComplete()) await fetchAll();
  } catch (e) {
    skip = `GitLab files unavailable: ${String(e)}`;
  }
}
if (skip) console.warn(`SKIPPING live oracle test: ${skip}. Install ruby and run "node scripts/fetch-gitlab.ts" to enable it.`);

const python = process.env.RE2_PYTHON ?? 'python3';
const hasRe2 = !skip && spawnSync(python, ['-c', 'import re2'], { timeout: 20_000 }).status === 0;

test('live differential vs GitLab Ruby code', { skip, timeout: 300_000 }, () => {
  const count = 4000;
  const rows = generateCorpus(count, 2);
  const dir = mkdtempSync(join(tmpdir(), 'gitlab-rules-if-'));
  writeFileSync(join(dir, 'in.json'), JSON.stringify(rows));
  execFileSync('ruby', [join(root, 'scripts', 'oracle', 'run_oracle.rb'), join(dir, 'in.json'), join(dir, 'out.json')], {
    env: { ...process.env, GITLAB_CACHE: CACHE, RE2_PYTHON: python, ...(hasRe2 ? {} : { RE2_MODE: 'onigmo' }) },
    timeout: 250_000,
  });
  const out = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8')) as OracleResult[];
  let compared = 0;
  const unexplained: string[] = [];
  rows.forEach((r, i) => {
    if (!hasRe2 && !r.safe) return;
    compared++;
    const diff = compareRow(r.e, VARS, r.i ? INPUTS : undefined, out[i] as OracleResult);
    if (diff !== null && knownResidual(r.e) === undefined) unexplained.push(diff);
  });
  if (!hasRe2) console.warn(`google-re2 not importable by ${python}: compared ${compared} of ${count} rows (Onigmo stand-in)`);
  assert.ok(compared >= 3000 || !hasRe2);
  assert.deepEqual(unexplained.slice(0, 10), []);
  assert.ok(unexplained.length / compared <= 0.001);
});
