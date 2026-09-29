import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { Re2, RegexpSyntaxError } from '../src/index.ts';

const ok = (pattern: string, text: string): boolean => new Re2(pattern).matches(text);
const rejects = (pattern: string): void => {
  assert.throws(() => new Re2(pattern), RegexpSyntaxError, pattern);
};

test('rejects what RE2 rejects', () => {
  for (const p of ['(?=a)', '(?!a)', '(?<=a)', '(?<!a)', '\\1', '(a)\\1', 'a**', 'a++', 'a{2}{3}', '(', ')', '[a', '\\', '(?i', '[z-a]', '\\8', '\\Z', '\\e', '\\h', '\\cA', '(?#c)', '(?x)', '\\p{Foo}', '\\p{Cn}', 'a{1001}', '(a{10}){101}', '\\pL{447}', '*a', '(*)', '\\x{110000}', '[[:foo:]]', '[a-\\d]', '\\E']) rejects(p);
});

test('accepts what RE2 accepts', () => {
  assert.doesNotThrow(() => new Re2('\\pL{446}'));
  for (const p of ['', '()', '(?:)', '(?i)', 'a{', 'a{,3}', 'a{01}', '[]a]', '[^]a]', '[a-]', '\\_', '\\/', '\\pN', '\\p{^Greek}', '(?P<n>a)(?P<n>b)', '(?<n>a)', '\\Qab', 'a(?i)*', '\\C', '(?)']) {
    assert.doesNotThrow(() => new Re2(p), p);
  }
});

test('anchors, classes and flags follow RE2 rather than JavaScript', () => {
  assert.equal(ok('^$', ''), true);
  assert.equal(ok('a$', 'a\n'), false); // $ is end of text, not before a final newline
  assert.equal(ok('(?m)a$', 'a\nb'), true);
  assert.equal(ok('\\d', '٣'), false); // ASCII only
  assert.equal(ok('\\s', '\v'), false);
  assert.equal(ok('[[:space:]]', '\v'), true);
  assert.equal(ok('\\w', 'é'), false);
  assert.equal(ok('\\pL', 'é'), true);
  assert.equal(ok('(?i)k', 'K'), true); // Kelvin sign folds to k
  assert.equal(ok('(?i)\\P{Lu}', 'a'), false);
  assert.equal(ok('a.c', 'a\nc'), false);
  assert.equal(ok('(?s)a.c', 'a\nc'), true);
  assert.equal(ok('[^a]', '\n'), true);
  assert.equal(ok('\\bfoo\\b', 'a foo b'), true);
  assert.equal(ok('\\Qa.b\\E', 'a.b'), true);
  assert.equal(ok('\\Qa.b\\E', 'aXb'), false);
});

test('zero-width matches count', () => {
  assert.equal(ok('', 'abc'), true);
  assert.equal(ok('x*', 'abc'), true);
  assert.equal(ok('^', 'abc'), true);
  assert.equal(ok('\\B', 'é'), true); // RE2 finds a boundary inside the two UTF-8 bytes
});

test('matching is linear: nested quantifiers do not backtrack', () => {
  const started = Date.now();
  assert.equal(ok('(a+)+$', `${'a'.repeat(5000)}b`), false);
  assert.equal(ok('(x+x+)+y', 'x'.repeat(3000)), false);
  assert.ok(Date.now() - started < 5000);
});

test('scan quirk: a group-less pattern with an unterminated \\Q never scans', () => {
  const re = new Re2('\\Qab');
  assert.equal(re.matches('ab'), true);
  assert.equal(re.scanFinds('ab'), false);
});

interface Fixture {
  rows: [string, string[], boolean[] | null][];
}
const fx = JSON.parse(gunzipSync(readFileSync(join(import.meta.dirname, 'fixtures', 're2.json.gz'))).toString('utf8')) as Fixture;

test(`agrees with Google RE2 on ${fx.rows.length} generated patterns (fixture)`, () => {
  let agree = 0;
  const residual: string[] = [];
  for (const [pattern, texts, expected] of fx.rows) {
    let re: Re2 | undefined;
    try {
      re = new Re2(pattern);
    } catch (e) {
      if (!(e instanceof RegexpSyntaxError)) throw e;
    }
    let same: boolean;
    if (expected === null) same = re === undefined;
    else same = re !== undefined && texts.every((t, i) => (re as Re2).matches(t) === expected[i]);
    if (same) agree++;
    else residual.push(pattern);
  }
  const explained = residual.every((p) => /\\C/.test(p));
  console.log(`agreement ${agree}/${fx.rows.length}; residual patterns: ${residual.length}`);
  assert.ok(explained, `unexplained: ${residual.filter((p) => !/\\C/.test(p)).slice(0, 5).join(' , ')}`);
  assert.ok(agree / fx.rows.length >= 0.995);
});
