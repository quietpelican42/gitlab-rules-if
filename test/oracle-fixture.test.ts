// Replays the committed oracle results (test/fixtures/expressions.json.gz): 12,000 generated
// expressions that GitLab's own Ruby code evaluated, with regexes run by Google RE2.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import type { OracleResult } from './oracle-compare.ts';
import { compareRow, knownResidual } from './oracle-compare.ts';

interface Fixture {
  gitlabRef: string;
  seed: number;
  vars: Record<string, string>;
  inputs: Record<string, string | number | boolean | null>;
  rows: [string, 0 | 1, 0 | 1, OracleResult][];
}

const fixture = JSON.parse(gunzipSync(readFileSync(join(import.meta.dirname, 'fixtures', 'expressions.json.gz'))).toString('utf8')) as Fixture;

test(`differential vs GitLab's Ruby code (${fixture.rows.length} expressions, ref ${fixture.gitlabRef.slice(0, 12)})`, () => {
  assert.ok(fixture.rows.length >= 10000);
  let bad = 0;
  const residuals = new Map<string, number>();
  const unexplained: string[] = [];
  for (const [expression, usesInputs, , oracle] of fixture.rows) {
    const diff = compareRow(expression, fixture.vars, usesInputs ? fixture.inputs : undefined, oracle);
    if (diff === null) continue;
    bad++;
    const why = knownResidual(expression);
    if (why === undefined) unexplained.push(diff);
    else residuals.set(why, (residuals.get(why) ?? 0) + 1);
  }
  const rate = 1 - bad / fixture.rows.length;
  console.log(`agreement ${(rate * 100).toFixed(3)}% (${fixture.rows.length - bad}/${fixture.rows.length}); residuals: ${JSON.stringify([...residuals])}`);
  assert.deepEqual(unexplained.slice(0, 10), []);
  assert.ok(rate >= 0.999, `agreement ${rate}`);
});

test('the corpus exercises errors, crashes, regex values and both truth values', () => {
  const kinds = new Set<string>();
  for (const [, , , o] of fixture.rows) {
    if (o.err) kinds.add(`${o.err}:${o.msg}`);
    else if (o.crash) kinds.add('crash');
    else kinds.add(`t=${o.t}`);
  }
  for (const k of ['t=true', 't=false', 'crash', 'SyntaxError:Unknown lexeme found!', 'SyntaxError:Invalid regular expression!', 'SyntaxError:Too many tokens!', 'ParseError:Unmatched parenthesis', 'OperatorError:Invalid left operand']) {
    assert.ok(kinds.has(k), `missing ${k}`);
  }
});
