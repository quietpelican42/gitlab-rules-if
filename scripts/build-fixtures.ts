// Rebuilds the committed fixtures from the live oracles.
//   GITLAB_CACHE is fetched first (node scripts/fetch-gitlab.ts).
//   RE2_PYTHON must point at a Python with the `google-re2` wheel installed:
//     python3 -m venv .venv && .venv/bin/pip install google-re2
//     RE2_PYTHON=.venv/bin/python node scripts/build-fixtures.ts
//
// Writes test/fixtures/expressions.json.gz (rows from the Ruby oracle running
// GitLab's code) and test/fixtures/re2.json.gz (patterns run through Google RE2).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { generateCorpus, INPUTS, VARS } from './gen-corpus.ts';
import { generateRegexCorpus } from './gen-regex-corpus.ts';

const root = join(import.meta.dirname, '..');
const python = process.env.RE2_PYTHON ?? 'python3';
const tmp = join(tmpdir(), `gitlab-rules-if-${process.pid}`);
mkdirSync(tmp, { recursive: true });
mkdirSync(join(root, 'test', 'fixtures'), { recursive: true });
const manifest = JSON.parse(readFileSync(join(root, 'scripts', 'gitlab-files.json'), 'utf8')) as { ref: string };

// ---- expressions: GitLab's Ruby code + RE2 ----
const EXPR_SEED = 1;
const EXPR_COUNT = 12000;
const corpus = generateCorpus(EXPR_COUNT, EXPR_SEED);
writeFileSync(join(tmp, 'corpus.json'), JSON.stringify(corpus));
execFileSync('ruby', [join(root, 'scripts', 'oracle', 'run_oracle.rb'), join(tmp, 'corpus.json'), join(tmp, 'out.json')], {
  env: { ...process.env, RE2_PYTHON: python },
  timeout: 300_000,
});
const out = JSON.parse(readFileSync(join(tmp, 'out.json'), 'utf8')) as Record<string, unknown>[];
const exprFixture = {
  gitlabRef: manifest.ref,
  seed: EXPR_SEED,
  vars: VARS,
  inputs: INPUTS,
  rows: corpus.map((r, i) => [r.e, r.i ? 1 : 0, r.safe ? 1 : 0, out[i]]),
};
writeFileSync(join(root, 'test', 'fixtures', 'expressions.json.gz'), gzipSync(JSON.stringify(exprFixture)));

// ---- regexes: Google RE2 ----
const RE_SEED = 1;
const rx = generateRegexCorpus(6000, RE_SEED);
writeFileSync(join(tmp, 'rx.json'), JSON.stringify(rx));
const res = JSON.parse(
  execFileSync(python, [join(root, 'scripts', 'run-re2.py'), join(tmp, 'rx.json')], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    timeout: 300_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  }),
) as { ok: boolean; m?: boolean[] }[];
writeFileSync(
  join(root, 'test', 'fixtures', 're2.json.gz'),
  gzipSync(JSON.stringify({ seed: RE_SEED, rows: rx.map((r, i) => [r.p, r.t, res[i]?.ok ? res[i]?.m : null]) })),
);
console.log('fixtures written');
