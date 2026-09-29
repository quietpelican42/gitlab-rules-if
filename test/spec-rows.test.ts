// GitLab's own spec rows (statement, lexer, parser, matches, not_matches), fetched at
// test time from a pinned commit and checked against pinned sha256 values.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { cacheComplete, CACHE, fetchAll, GITLAB_REF } from '../scripts/fetch-gitlab.ts';
import type { Ast } from '../src/index.ts';
import { evaluateValue, inputNames, inspect, RegexValue, truthful } from '../src/index.ts';
import { evaluateNode } from '../src/evaluate.ts';
import { tokenize } from '../src/lexer.ts';
import { buildTree } from '../src/parser.ts';
import { lexerRows, matchCases, parserRows, statementRows } from './gitlab-specs.ts';

let skip: string | false = false;
try {
  if (!cacheComplete()) await fetchAll();
} catch (e) {
  skip = `GitLab spec files unavailable (${String(e)}). Run "node scripts/fetch-gitlab.ts" with network access to enable these tests.`;
  console.warn(`SKIPPING GitLab spec rows: ${skip}`);
}

const dir = join(CACHE, 'spec/lib/gitlab/ci/pipeline/expression');
const read = (f: string): string => readFileSync(join(dir, f), 'utf8');

const VARS = {
  PRESENT_VARIABLE: 'my variable',
  PATH_VARIABLE: 'a/path/variable/value',
  FULL_PATH_VARIABLE: '/a/full/path/variable/value',
  EMPTY_VARIABLE: '',
};
const PATTERN_VARS = { teststring: 'abcde', pattern1: '/^ab.*/', pattern2: '/^at.*/' };

test(`statement_spec rows (GitLab ${GITLAB_REF.slice(0, 12)})`, { skip }, () => {
  const rows = statementRows(read('statement_spec.rb'));
  const failures: string[] = [];
  let n = 0;
  const check = (label: string, fn: () => void): void => {
    n++;
    try {
      fn();
    } catch (e) {
      failures.push(`${label}: ${String(e).split('\n')[0]}`);
    }
  };
  for (const r of rows.evaluate) check(`evaluate ${r.expr}`, () => assert.deepEqual(evaluateValue(r.expr, VARS), r.value));
  const inputs = { cloud_provider: 'aws', environment: 'production' };
  for (const r of rows.inputs) check(`inputs ${r.expr}`, () => assert.deepEqual(evaluateValue(r.expr, {}, { inputs }), r.value));
  for (const r of rows.truthful) check(`truthful ${r.expr}`, () => assert.equal(truthful(r.expr, VARS), r.value));
  for (const r of rows.patternVars) check(`pattern ${r.expr}`, () => assert.equal(truthful(r.expr, PATTERN_VARS), r.value));
  for (const r of rows.inputNames) {
    check(`input_names ${r.expr}`, () => {
      const got = inputNames(r.expr);
      assert.deepEqual(r.ordered ? got : [...got].sort(), r.ordered ? r.names : [...r.names].sort());
    });
  }
  assert.equal(n, 93 + 3 + 19 + 4 + 7);
  assert.deepEqual(failures, [], `${failures.length} of ${n} rows failed`);
});

test('lexer_spec rows', { skip }, () => {
  const rows = lexerRows(read('lexer_spec.rb'));
  assert.equal(rows.length, 12);
  for (const r of rows) assert.deepEqual(tokenize(r.expr).map((t) => t.value), r.tokens, r.expr);
});

test('parser_spec rows', { skip }, () => {
  const rows = parserRows(read('parser_spec.rb'));
  for (const r of rows.trees) assert.equal(inspect(buildTree(tokenize(r.expr))), r.tree, r.expr);
  for (const r of rows.errors) {
    assert.throws(() => buildTree(tokenize(r.expr)), (e: Error) => e.name === r.error, `${r.expr} should raise ${r.error}`);
  }
  for (const expr of rows.unmatched) {
    assert.throws(() => buildTree(tokenize(expr)), (e: Error) => e.name === 'ParseError', expr);
  }
});

for (const [file, type] of [['matches_spec.rb', 'matches'], ['not_matches_spec.rb', 'notMatches']] as const) {
  test(`${file} rows`, { skip }, () => {
    const cases = matchCases(read(`lexeme/${file}`));
    assert.equal(cases.length, 13);
    for (const c of cases) {
      const left: Ast = c.left === null ? { type: 'null' } : { type: 'string', value: c.left };
      let right: Ast;
      if (c.right === null) right = { type: 'null' };
      else if ('regexp' in c.right) right = { type: 'pattern', value: '', regex: new RegexValue(c.right.regexp) };
      else right = { type: 'string', value: c.right.string };
      const got = evaluateNode({ type, left, right }, { variables: {}, inputs: {} });
      assert.equal(got, c.expected, c.name);
    }
  });
}
