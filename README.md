# gitlab-rules-if

Evaluates GitLab CI `rules:if` expressions (the same expression syntax `only:variables` uses) the way GitLab's own Ruby code does, including RE2 regex semantics.

```ts
import { evaluate } from 'gitlab-rules-if';

const variables = { CI_COMMIT_BRANCH: 'main', CI_PIPELINE_SOURCE: 'push' };

evaluate('$CI_COMMIT_BRANCH == "main" && $CI_PIPELINE_SOURCE =~ /^(push|web)$/', variables); // true
evaluate('$EMPTY_VARIABLE =~ /^$/', { EMPTY_VARIABLE: '' }); // true (zero-width match)
evaluate('$CI_COMMIT_TAG', variables); // false (undefined is nil)
```

## Why

GitLab evaluates these expressions server-side. Tools that run pipelines or lint them offline have to reimplement the language, and the reimplementations rewrite the expression into JavaScript and `eval` it. The result differs from GitLab on cases that decide whether a job runs:

- A zero-width regex match (`$EMPTY =~ /^$/`) is a match in GitLab.
- `""` is truthy inside `&&` and `||` (Ruby), so `$EMPTY && "x"` is `"x"`.
- A whitespace-only value is blank at the end (`present?`).
- `false == "false"` is true.
- A pattern of one character (`/a/`) is a lexer error, not a regex.
- RE2 rejects backreferences and lookarounds, and `\d`, `\s`, `\w` are ASCII-only.

This library ports GitLab's lexer, parser and evaluation rules and compiles regexes with its own RE2 implementation. It has no runtime dependencies.

Incumbents checked: the npm registry has no package for this (names tried: `gitlab-rules-if`, `gitlab-ci-rules`, `gitlab-rules`, `gitlab-ci-expression`, `gitlab-ci-expr`, `gitlab-expr`, `gitlab-ci-eval`, `gitlab-if`, `gitlab-ci-evaluator`, `gitlab-ci-if`, `gitlab-ci-rules-if`, `gitlab-rules-js`, `node-gitlab-rules`, `gitlab-expression`, `gitlab-ci-expressions`, `gitlab-pipeline-rules`), and `npm search` and `gh search repos` found no standalone evaluator. The only implementation found is `Utils.evaluateRuleIf` inside firecow/gitlab-ci-local, which is part of a CLI and is not exported.

| Implementation | Form | GitLab spec rows | Differential vs GitLab's Ruby code |
| --- | --- | --- | --- |
| gitlab-ci-local `evaluateRuleIf` (commit d5c9cf7, re2js) | regex rewrite, then `eval`; inside a CLI | 113 of 116 | 76.17% on the 8,031 fixture rows below; 93.45% on 4,000 rows using only simple patterns |
| gitlab-rules-if | lexer, parser and RE2 engine | all rows, see Development | 100.000% on 12,000 fixture rows and on 60,000 further generated rows; 10 residual patterns out of 30,000 on the regex layer, all `\C` |

Measured: a one-off harness (not shipped) that copies `Utils.evaluateRuleIf` from gitlab-ci-local commit d5c9cf7 and runs the rows of `test/fixtures/expressions.json.gz` that use no `inputs` through it, comparing truthiness or error against the oracle:

```
gitlab-ci-local: 6117 of 8031 rows agree (76.17%); 4227 of 5703 rows GitLab evaluates (74.12%)
gitlab-rules-if: 8031 of 8031 rows agree
```

The generated corpus is adversarial (malformed input, RE2-only syntax, Unicode). The 93.45% figure comes from a corpus of plain variables, strings and two-character-or-longer patterns. The divergences trace to the list above and to GitLab's regex rules.

Issues in gitlab-ci-local's tracker in this area (titles verified against the tracker): #1893 "Nested `$variable` inside a `=~` regex pattern produces an invalid regex and crashes rule evaluation" (open), #1688 "Regex issue in if: clause", #932 "PCRE RegEx broken", #1162 "Changed rule regex and got exception", #350 "Error in substitution when rules contains a regex with a eol-match", #299 "Undefined variables regex matching fails when used with &&", #273 "rules evaluation does not support regex modifiers like case insensitivity".

## Installation

```sh
npm install gitlab-rules-if
```

Node 20.6 or later. No runtime dependencies.

## Usage

### Evaluate a rule

`evaluate` returns what GitLab's `rules:if` uses: the expression's value through Ruby's `present?`. It throws where GitLab raises an expression error.

```ts
import { evaluate, truthful } from 'gitlab-rules-if';

evaluate('$A == "x"', { A: 'x' }); // true
evaluate('$A ==', {}); // throws OperatorError
truthful('$A ==', {}); // false: GitLab's Statement#truthful? turns expression errors into false
```

### Get the raw value

```ts
import { evaluateValue } from 'gitlab-rules-if';

evaluateValue('$EMPTY && "x"', { EMPTY: '' }); // "x"
evaluateValue('$EMPTY || "x"', { EMPTY: '' }); // ""
evaluateValue('$UNDEFINED', {}); // null
```

### Inputs

`$[[ inputs.name ]]` reads from the `inputs` option, not from the variables.

```ts
evaluate('$[[ inputs.env ]] == "prod"', {}, { inputs: { env: 'prod' } }); // true
```

### Parse and inspect

```ts
import { parse, inspect, tokenize } from 'gitlab-rules-if';

inspect(parse('$A || $B && !$C')); // or($A, and($B, not($C)))
tokenize('$A =~ /x+/i').map((t) => t.lexeme); // ['variable', 'matches', 'pattern']
```

### Use the RE2 engine directly

```ts
import { Re2 } from 'gitlab-rules-if';

new Re2('(a+)+$').matches('a'.repeat(5000) + 'b'); // false, in linear time
new Re2('(?=a)'); // throws RegexpSyntaxError, as RE2 does
```

## Reference

### Functions

| Function | Returns | Description |
| --- | --- | --- |
| `evaluate(expression, variables?, options?)` | `boolean` | The `rules:if` result. Throws `ExpressionError` subclasses where GitLab does. |
| `truthful(expression, variables?, options?)` | `boolean` | `evaluate`, with any `ExpressionError` turned into `false`. |
| `evaluateValue(expression, variables?, options?)` | `string \| boolean \| number \| null \| RegexValue` | The value before `present?`. `null` is Ruby's nil. |
| `parse(expression)` | `Ast` | The parse tree. Compiles regex literals, so an invalid one throws here. |
| `tokenize(expression)` | `Token[]` | `{ lexeme, value }` per token. `lexeme` is one of `parenthesisopen`, `parenthesisclose`, `input`, `variable`, `string`, `pattern`, `null`, `boolean`, `equals`, `matches`, `notequals`, `notmatches`, `and`, `or`, `not`. |
| `inspect(ast)` | `string` | GitLab's `inspect` rendering of a tree. |
| `inputNames(expression)` | `string[]` | Input names referenced, deduplicated. Returns `[]` for an invalid expression. GitLab does not look below `!`. |
| `present(value)` | `boolean` | Ruby's `present?` for the value kinds above. |
| `new Re2(source)` | `Re2` | An RE2 pattern. `matches(text)` is true if it matches anywhere. `scanFinds(text)` is GitLab's `scan(text).present?`. |

`variables` is a plain object or a `Map`. Values may be `string`, `boolean`, integer `number`, `null` or `undefined` (both mean nil). Other values throw `TypeError`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `inputs` | same shape as `variables` | `{}` | Values for `$[[ inputs.name ]]`. |

### Errors

| Class | GitLab class | Messages |
| --- | --- | --- |
| `LexerSyntaxError` | `Lexer::SyntaxError` | `Unknown lexeme found!`, `Too many tokens!`, `Invalid regular expression!` |
| `ParseError` | `Parser::ParseError` | `Unmatched parenthesis`, `Unreachable nodes in parse tree`, `Empty parse tree`, `Unprocessable token found in parse tree: parenthesis_open` |
| `OperatorError` | `Lexeme::Operator::OperatorError` | `Invalid left operand`, `Invalid right operand`, `Invalid operand` |
| `StatementError` | `Statement::StatementError` | the class path (no tokens) |
| `EvaluationCrash` | `NoMethodError` | Where GitLab's Ruby raises something that is not an expression error, for example `$A =~ true`. Not caught by `truthful`. |
| `RegexpSyntaxError` | `RegexpError` | Thrown by `new Re2`. Inside expressions it surfaces as `LexerSyntaxError`. |

`ExpressionError` is the base class of the first four.

## How it works

The lexer, the shunting-yard parser and the evaluation rules are ported from `lib/gitlab/ci/pipeline/expression/` in the GitLab source, pinned to commit `b25e75c5ddb403b336db9c35295a4292d8f1cb25`. That code is MIT-licensed (see `LICENSE-gitlab`, which is GitLab's license file verbatim). Details carried over:

- The lexeme order, the ASCII-only `\s` and `\w`, and the 100-iteration token limit (an expression of exactly 100 tokens already fails).
- Precedence: `||` 12, `&&` 11, comparisons 10, `!` 1. The tree is built in reverse Polish order, so errors appear in the same order.
- `&&` and `||` return operand values with Ruby truthiness. `!` and the final result use `present?`, which treats whitespace-only strings (Unicode `White_Space`) as blank.
- A boolean compares with a string by its text. Other comparisons are strict.
- `=~` and `!~` take the right value. A `/re/flags` string is compiled with RE2 after `\/` is unescaped, taking the first line that has the `/body/flags` shape. Any other string is not a pattern, and GitLab then calls `String#scan`, which is a literal substring search. Flags `i m s U` become an RE2 `(?flags)` prefix.
- Variables are not expanded inside strings, and `${VAR}` is not a lexeme.

The RE2 layer is a parser that follows RE2's `parse.cc` (escapes, classes, flags, repeat limits, rejected constructs) and a state-set NFA simulation, so matching is linear in the text length. Only "does it match anywhere" is answered, which is all `=~` needs. It runs on code points, and models RE2's byte-level behavior for `\B` inside multi-byte characters.

Subset and behavior:

- Supported: literals, `.`, classes with ranges, negation, POSIX names and `\d\s\w\D\S\W`, `\pN` / `\p{Name}` (RE2's category and script names), anchors `^ $ \A \z \b \B`, groups (capturing, `(?:)`, named), `(?i)`, `(?m)`, `(?s)`, `(?U)` and scoped flags, `* + ?` with lazy forms, `{n}` `{n,}` `{n,m}` up to 1000 with RE2's nested-repeat rule, `\Q...\E`, `\x..`, `\x{..}`, octal escapes, `\C`.
- Rejected as RE2 rejects them: backreferences, lookahead and lookbehind, `\Z`, `\G`, `\e`, `\h`, `\cX`, `(?#...)`, possessive quantifiers, repeat stacking (`a**`), `{n}` above 1000, unknown property names, and the other invalid syntax RE2 reports.
- `\d`, `\s`, `\w`, `\b` are ASCII. `\s` is `[\t\n\f\r ]` (no `\v`). `$` without `(?m)` is end of text only. Case folding is Unicode simple folding.

## Limitations

- Pinned to one GitLab commit. Older GitLab versions differ (for example, no `true`/`false` lexemes or `$[[ inputs ]]` in earlier releases).
- `\C` matches one code point here and one byte in RE2. Results differ on non-ASCII text.
- RE2's "pattern too large" limit depends on its UTF-8 compiler. Here each instruction costs 1 and the classes `\p{L}`, `\p{Ll}`, `\p{Lo}`, `\p{Lu}`, `\p{M}`, `\p{Mn}` carry weights calibrated against Google RE2. Other patterns near the limit may be accepted or rejected differently.
- Unicode property membership and case folding come from the JavaScript engine's Unicode tables (Unicode 17 in Node 24.20). RE2's tables depend on the RE2 build. Script names are the ones RE2 accepted in the version measured (through Unicode 15).
- Nesting deeper than 1000 groups is rejected. RE2 has no such limit.
- A regex value used as the left operand of `=~` is matched against a fixed placeholder string. Ruby's `to_s` embeds a memory address.
- A group-less pattern containing an unterminated `\Q` finds nothing under `scan`, because GitLab re-wraps it in parentheses and the wrapped form does not compile. What the `re2` gem then does was not verified; this is inferred from its C++ engine.
- Arrays, hashes and non-integer numbers are not accepted as variable or input values.
- Only expression evaluation is implemented. Variable expansion elsewhere in a pipeline, `$[[ inputs ]]` interpolation in YAML, and the Ruby-`Regexp` fallback GitLab uses in other code paths are not.

## Compatibility

Run: Node 24.20.0 on macOS (`npm test`, `npm run build`, `npm run test:dist`). The oracle ran on Ruby 2.6.10 with `google-re2` 1.1.20251105 (Python 3.14). The CI workflow lists Node 20, 22 and 24; only 24 was run locally. Node 20 and 22 are untested.

## Development

```sh
npm install
npx tsc --noEmit
npm test                  # unit tests, fixtures, GitLab spec rows, live oracle
npm run build && npm run test:dist
```

`npm test` runs:

- unit tests for evaluation rules, errors and the RE2 layer;
- `test/fixtures/expressions.json.gz`: 12,000 generated expressions with the results GitLab's Ruby code gave (regexes run by Google RE2);
- `test/fixtures/re2.json.gz`: 6,000 generated patterns with Google RE2's answers (5,997 agree, 3 differ, all `\C`);
- GitLab's own spec rows (`statement_spec`, `lexer_spec`, `parser_spec`, `matches_spec`, `not_matches_spec`), extracted from files fetched at test time, pinned to the commit above and checked against the sha256 values in `scripts/gitlab-files.json`;
- a live differential that regenerates a corpus, runs GitLab's Ruby code and compares.

The GitLab files are never committed. `node scripts/fetch-gitlab.ts` downloads them into `.cache/gitlab/`, and the tests do the same on first run. Without network access or Ruby, the spec-row and live tests skip with a message.

The live oracle runs GitLab's lexer, parser and value objects (`scripts/oracle/`), with a small shim for the Rails helpers. Regexes go to Google RE2 through a Python bridge when `python3` can `import re2` (`RE2_PYTHON` selects the interpreter):

```sh
python3 -m venv .venv && .venv/bin/pip install google-re2
RE2_PYTHON=.venv/bin/python npm test
```

Without `google-re2`, the shim falls back to Ruby's Regexp (`RE2_MODE=onigmo`) and only rows whose regexes both engines read the same way are compared.

`node scripts/build-fixtures.ts` regenerates the fixtures. The generators are `scripts/gen-corpus.ts` and `scripts/gen-regex-corpus.ts`.

## License

MIT. See [LICENSE](LICENSE). The lexer and parser are derived from GitLab's MIT-licensed source: see [LICENSE-gitlab](LICENSE-gitlab).
