import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluate,
  evaluateValue,
  EvaluationCrash,
  inputNames,
  inspect,
  LexerSyntaxError,
  OperatorError,
  parse,
  ParseError,
  RegexValue,
  StatementError,
  tokenize,
  truthful,
} from '../src/index.ts';

const V = { A: 'abc', E: '', WS: ' ', T: 'true', F: 'false', NUL: 'null', P: '/^ab/', BAD: '/a(/' };

test('ruby truthiness: only nil and false are falsy inside && and ||', () => {
  assert.equal(evaluateValue('$E && "x"', V), 'x');
  assert.equal(evaluateValue('$E || "x"', V), '');
  assert.equal(evaluateValue('$UNDEF || "x"', V), 'x');
  assert.equal(evaluateValue('null && "x"', V), null);
  assert.equal(evaluateValue('false || null', V), null);
});

test('the final value goes through present?', () => {
  assert.equal(evaluate('$E', V), false);
  assert.equal(evaluate('$WS', V), false);
  assert.equal(evaluate('"\u00a0"', V), false);
  assert.equal(evaluate('"\u200b"', V), true);
  assert.equal(evaluate('"0"', V), true);
  assert.equal(evaluate('"false"', V), true);
  assert.equal(evaluate('$E || $A', V), false); // "" is truthy, so || keeps it
  assert.equal(evaluate('!$WS', V), true);
});

test('booleans compare with strings by their text', () => {
  assert.equal(evaluate('false == "false"', V), true);
  assert.equal(evaluate('$F == false', V), true);
  assert.equal(evaluate('true != "true"', V), false);
  assert.equal(evaluate('true == "yes"', V), false);
  assert.equal(evaluate('null == false', V), false);
  assert.equal(evaluate('$UNDEF == null', V), true);
  assert.equal(evaluate('"" == null', V), false);
});

test('regex matching counts zero-width matches', () => {
  assert.equal(evaluate('$E =~ /^$/', V), true);
  assert.equal(evaluate('$A =~ /x*/', V), true);
  assert.equal(evaluate('$A =~ $CARET', { ...V, CARET: '/^/' }), true);
  assert.equal(evaluate('$E !~ /^$/', V), false);
  assert.equal(evaluate('$UNDEF =~ /^$/', V), true); // nil.to_s is ""
});

test('regex literals: flags, escaped slashes, anchors', () => {
  assert.equal(evaluate('$A =~ /ABC/i', V), true);
  assert.equal(evaluate('$A =~ /ABC/', V), false);
  assert.equal(evaluate('"a/b" =~ /a\\/b/', V), true);
  assert.throws(() => parse('"a\nb" =~ /^b/m'), /Unknown lexeme found!/); // string literals cannot hold a newline
  assert.equal(evaluate('$M =~ /^b/m', { M: 'a\nb' }), true);
  assert.equal(evaluate('$M =~ /^b/', { M: 'a\nb' }), false);
  assert.equal(evaluate('$M =~ /a.b/s', { M: 'a\nb' }), true);
});

test('a variable holding /re/flags is compiled; anything else is a literal substring search', () => {
  assert.equal(evaluate('$A =~ $P', V), true);
  assert.equal(evaluate('"xyz" =~ $P', V), false);
  assert.equal(evaluate('$A =~ $A', V), true);
  // not a pattern: GitLab calls String#scan on the pattern string with the text
  assert.equal(evaluate('"b" =~ $A', V), true);
  assert.equal(evaluate('"z" =~ $A', V), false);
  assert.equal(evaluate('"z" !~ $A', V), true);
  assert.equal(evaluate('$A =~ $BAD', V), false);
  assert.equal(evaluate('"a(" =~ $BAD', V), true); // "/a(/" contains "a("
  assert.equal(evaluate('"/a(/" =~ $BAD', V), true);
  assert.equal(evaluate('$A =~ null', V), false);
  assert.equal(evaluate('$A !~ null', V), true);
});

test('only the first line of a multi-line pattern string counts', () => {
  assert.equal(evaluate('"a" =~ $TWO', { TWO: '/a/\n/b/' }), true);
  assert.equal(evaluate('"b" =~ $TWO', { TWO: '/a/\n/b/' }), false);
});

test('a bare regex is a value', () => {
  const v = evaluateValue('/ab/i');
  assert.ok(v instanceof RegexValue);
  assert.equal(v.source, '(?i)ab');
  assert.equal(evaluate('/ab/'), true);
  assert.equal(evaluate('!/ab/'), false);
  assert.equal(evaluate('/ab/ == /ab/'), true);
  assert.equal(evaluate('/ab/ != /ab/i'), true);
});

test('errors GitLab raises for unusable regexes', () => {
  assert.throws(() => parse('$A =~ /a(/'), LexerSyntaxError);
  assert.throws(() => parse('$A =~ /(?=a)/'), /Invalid regular expression!/);
  assert.throws(() => parse('$A =~ /a\\1/'), LexerSyntaxError);
  assert.throws(() => parse('$A =~ /a/x'), /Unknown lexeme found!/);
  assert.throws(() => parse('$A =~ /a/'), /Unknown lexeme found!/); // a pattern needs two characters
  assert.throws(() => parse('$A =~ //'), /Unknown lexeme found!/);
});

test('not-a-string operands crash the way GitLab does (NoMethodError)', () => {
  assert.throws(() => evaluate('$A =~ true', V), EvaluationCrash);
  assert.throws(() => evaluate('$A !~ true', V), EvaluationCrash);
  assert.throws(() => evaluate('/ab/ == "ab"', V), EvaluationCrash);
  assert.equal(evaluate('$A =~ false', V), false);
  assert.equal(truthful('$A =~ false', V), false);
  assert.throws(() => truthful('$A =~ true', V), EvaluationCrash);
});

test('variables are not expanded inside strings and ${VAR} is not a lexeme', () => {
  assert.equal(evaluate('"$A" == "abc"', V), false);
  assert.equal(evaluate('"$A" == "$A"', V), true);
  assert.throws(() => parse('${A} == "abc"'), /Unknown lexeme found!/);
  assert.equal(evaluate('$A == "abc"', V), true);
});

test('precedence and parentheses', () => {
  assert.equal(inspect(parse('$A || $B && $C')), 'or($A, and($B, $C))');
  assert.equal(inspect(parse('!$A == $B')), 'equals(not($A), $B)');
  assert.equal(inspect(parse('$A && ($B || $C)')), 'and($A, or($B, $C))');
  assert.equal(inspect(parse('$A == "x" == $B')), 'equals(equals($A, "x"), $B)');
  assert.equal(inspect(parse('$A =~ /ab/i')), 'matches($A, //ab/i/)');
});

test('input references', () => {
  assert.equal(evaluate('$[[ inputs.env ]] == "prod"', {}, { inputs: { env: 'prod' } }), true);
  assert.equal(evaluate('$[[inputs.env]]', {}, { inputs: { env: 'prod' } }), true);
  assert.equal(evaluate('$[[ inputs.flag ]] == true', {}, { inputs: { flag: true } }), true);
  assert.equal(evaluate('$[[ inputs.n ]] == "5"', {}, { inputs: { n: 5 } }), false);
  assert.equal(evaluate('$[[ inputs.missing ]]', {}, { inputs: {} }), false);
  assert.equal(evaluate('$[[ inputs.missing ]] == null'), true);
  assert.deepEqual(inputNames('$[[ inputs.a ]] == "x" && !$[[ inputs.b ]]'), ['a']); // GitLab does not look under !
  assert.deepEqual(inputNames('$[[ inputs.a ]] == $[[ inputs.a ]]'), ['a']);
  assert.deepEqual(inputNames('&&'), []);
});

test('errors and their kinds', () => {
  assert.throws(() => parse(''), StatementError);
  assert.throws(() => parse('   '), StatementError);
  assert.throws(() => parse('$A $B'), (e: Error) => e instanceof ParseError && e.message === 'Unreachable nodes in parse tree');
  assert.throws(() => parse('()'), (e: Error) => e instanceof ParseError && e.message === 'Empty parse tree');
  assert.throws(() => parse('$A)'), (e: Error) => e instanceof ParseError && e.message === 'Unmatched parenthesis');
  assert.throws(() => parse('($A'), /Unprocessable token found in parse tree: parenthesis_open/);
  assert.throws(() => parse('== $A'), (e: Error) => e instanceof OperatorError && e.message === 'Invalid left operand');
  // the single operand is popped as the right side, so the left side is what is missing
  assert.throws(() => parse('$A =='), (e: Error) => e instanceof OperatorError && e.message === 'Invalid left operand');
  assert.throws(() => parse('!'), (e: Error) => e instanceof OperatorError && e.message === 'Invalid operand');
  assert.throws(() => parse('$A = 1'), /Unknown lexeme found!/);
  assert.throws(() => parse('$A == 1'), LexerSyntaxError);
  assert.throws(() => parse('$A == "a\nb"'), /Unknown lexeme found!/);
  assert.equal(truthful('$INVALID = 1'), false);
  assert.equal(truthful('&&'), false);
});

test('the token limit is hit at exactly 100 tokens', () => {
  const n = (k: number): string => Array.from({ length: k }, () => '$A').join(' || ').replaceAll('||', '||');
  // 50 operands and 49 operators = 99 tokens
  assert.equal(tokenize(n(50)).length, 99);
  // 51 operands and 50 operators = 101 tokens
  assert.throws(() => tokenize(n(51)), /Too many tokens!/);
  // exactly 100 tokens: the lexer needs a 101st iteration to see the end
  assert.throws(() => tokenize(`${n(50)} !`), /Too many tokens!/);
  assert.equal(tokenize('$A $B $C', 4).length, 3);
  assert.throws(() => tokenize('$A $B $C $D', 3), /Too many tokens!/);
});

test('lexeme boundaries match GitLab', () => {
  assert.deepEqual(tokenize('$A==$B').map((t) => t.lexeme), ['variable', 'equals', 'variable']);
  assert.deepEqual(tokenize('true false').map((t) => t.lexeme), ['boolean', 'boolean']);
  assert.throws(() => tokenize('trueish'), /Unknown lexeme found!/);
  assert.throws(() => tokenize('true1'), /Unknown lexeme found!/);
  assert.deepEqual(tokenize('nullnull').map((t) => t.lexeme), ['null', 'null']); // null has no word boundary
  assert.deepEqual(tokenize("'a' \"b\"").map((t) => t.value), ["'a'", '"b"']);
  assert.throws(() => tokenize('\u00a0$A'), /Unknown lexeme found!/); // only ASCII whitespace is skipped
  assert.deepEqual(tokenize('\v$A\f').map((t) => t.value), ['$A']);
  assert.deepEqual(tokenize('$[[ inputs.a-b ]]').map((t) => t.lexeme), ['input']);
});

test('variables: plain objects, maps, and prototype names', () => {
  assert.equal(evaluate('$constructor', {}), false);
  assert.equal(evaluate('$toString', {}), false);
  assert.equal(evaluate('$A', new Map([['A', 'x']])), true);
  assert.equal(evaluate('$A', { A: null }), false);
  assert.equal(evaluate('$A', { A: undefined }), false);
  assert.throws(() => evaluate('$A', { A: 1.5 }), TypeError);
});
