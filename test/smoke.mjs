/**
 * Plain-JS checks against the built package, so they run on every Node version
 * in `engines` (the TypeScript suite needs type stripping and only runs on 24+).
 *
 *   npm run build && node --test test/smoke.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const lib = await import('../dist/index.js');
const { evaluate, evaluateValue, parse, inspect, truthful, inputNames, tokenize, Re2, LexerSyntaxError, ParseError, EvaluationCrash } = lib;

const V = { PRESENT: 'my variable', EMPTY: '', PATH: 'a/path/variable/value' };

test('evaluates rules:if expressions', () => {
  assert.equal(evaluate('$PRESENT == "my variable"', V), true);
  assert.equal(evaluate('$PRESENT =~ /VAR.*/i', V), true);
  assert.equal(evaluate('$PATH =~ /path\\/variable/', V), true);
  assert.equal(evaluate('$EMPTY', V), false);
  assert.equal(evaluate('!$EMPTY', V), true);
  assert.equal(evaluate('($PRESENT && null) || $EMPTY == ""', V), true);
});

test('ruby truthiness and coercion', () => {
  assert.equal(evaluateValue('$EMPTY && "string"', V), 'string');
  assert.equal(evaluateValue('$EMPTY || "string"', V), '');
  assert.equal(evaluate('false == "false"'), true);
  assert.equal(evaluate('$EMPTY =~ /^$/', V), true);
});

test('RE2 rules apply to patterns', () => {
  assert.throws(() => parse('$A =~ /(?=x)/'), LexerSyntaxError);
  assert.throws(() => parse('$A =~ /(a)\\1/'), LexerSyntaxError);
  assert.equal(new Re2('(a+)+$').matches(`${'a'.repeat(4000)}b`), false);
  assert.equal(new Re2('\\d').matches('\u0663'), false);
});

test('parse, tokenize and errors', () => {
  assert.equal(inspect(parse('$A || $B && $C')), 'or($A, and($B, $C))');
  assert.deepEqual(tokenize('$A == "x"').map((t) => t.lexeme), ['variable', 'equals', 'string']);
  assert.throws(() => parse('($A'), ParseError);
  assert.throws(() => evaluate('$A =~ true', { A: 'x' }), EvaluationCrash);
  assert.equal(truthful('$A ='), false);
  assert.deepEqual(inputNames('$[[ inputs.env ]] == "prod"'), ['env']);
  assert.equal(evaluate('$[[ inputs.env ]] == "prod"', {}, { inputs: { env: 'prod' } }), true);
});
