// Generates a seeded corpus of GitLab CI expressions for the differential test.
// Rows: { e: expression, v: variables, i?: inputs, safe: boolean }.
// `safe` marks rows whose regexes read the same in RE2 and in Ruby's Regexp, so
// they stay comparable when the oracle runs without RE2 (RE2_MODE=onigmo).
//
//   node scripts/gen-corpus.ts [count] [seed] > corpus.json

import { generatePatterns, mulberry32 } from './gen-regex-corpus.ts';

export interface Row {
  e: string;
  v: Record<string, string>;
  i?: Record<string, string | number | boolean | null>;
  safe: boolean;
}

export const VARS: Record<string, string> = {
  PRESENT_VARIABLE: 'my variable',
  PATH_VARIABLE: 'a/path/variable/value',
  FULL_PATH_VARIABLE: '/a/full/path/variable/value',
  EMPTY_VARIABLE: '',
  teststring: 'abcde',
  pattern1: '/^ab.*/',
  pattern2: '/^at.*/',
  WS: ' ',
  TABS: '\t\n',
  NBSP: ' ',
  A: 'abc',
  B: 'ABC',
  N: '123',
  TRUE: 'true',
  FALSE: 'false',
  PAT: '/b+/i',
  BADPAT: '/a(/',
  PLAIN: 'b',
  SLASHES: 'a/b',
  MULTI: 'line1\nline2',
  UNI: 'héllo wörld',
  ML: '/^b$/m',
  EMPTYPAT: '//',
  ESCAPED: '/a\\/b/',
  TWOLINE: '/a/\n/b/',
  ZWS: '​',
  NEL: '\u0085',
};
const NAMES = [...Object.keys(VARS), 'UNDEF1', 'UNDEF2', 'UNDEF1', 'UNDEF2'];
export const INPUTS: Record<string, string | number | boolean | null> = { s: 'x', t: '', flag: true, off: false, n: 5, z: null, name: 'abc', pat: '/b/' };
const INPUT_NAMES = [...Object.keys(INPUTS), 'missing'];

// Regexes both engines read the same way: no \s (RE2 lacks \v), no \b, no Unicode classes.
const SAFE_PATTERNS = [
  '^ab.*', '^at.*', 'var.*e$', 'my var', 'nope', 'VAR.*', '^var.*', 'b+', '^b$', 'a|b', '(a|b)+c', '[a-c]+', '[^a-c]', '\\d+', '\\w+', '\\W',
  '^$', '', 'x*', '^', '$', '.*', 'a.c', '^a\\/b$', 'path\\/variable', '^\\/a\\/full', 'value$', 'abc', 'ABC', '(?i)abc', 'a{2}', 'a{1,3}b', 'z?',
  'l.ne\\d', '^line1$', 'e1.l', 'c$', 'é', 'h.llo', '[[:alpha:]]+', '[[:^alpha:]]', 'a+?b', '(?:ab)*', '[a-]', '\\.', '\\$', 'a\\|b', '\\x61', 'true', 'null',
];
const SAFE_FLAGS = ['', '', '', '', 'i', 'i', 'm', 's', 'im', 'is', 'U', 'ii'];
const STRINGS = ['', ' ', 'abc', 'ABC', 'my variable', 'true', 'false', 'null', '0', 'a/b', '/b+/i', '/^a/', 'é', '$A', '${A}', 'x y', '\t', 'a"b', "it's", '/', '//', 'b', 'nope'];

export function generateCorpus(count: number, seed = 1): Row[] {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  const chance = (p: number): boolean => rnd() < p;
  const wild = generatePatterns(400, seed + 1000).filter((p) => !p.includes('\n'));

  let safe = true;
  let usesInputs = false;

  function regexLiteral(): string {
    if (chance(0.72)) {
      return `/${pick(SAFE_PATTERNS).replace(/\//g, '\\/')}/${pick(SAFE_FLAGS)}`;
    }
    safe = false;
    const p = pick(wild).replace(/\//g, '\\/');
    return `/${p}/${pick(['', '', 'i', 'm', 's', 'U', 'ims', 'x'])}`;
  }

  function variable(): string {
    const n = pick(NAMES);
    if (chance(0.01)) return `\${${n}}`;
    return `$${n}`;
  }

  function input(): string {
    usesInputs = true;
    const n = pick(INPUT_NAMES);
    return pick([`$[[ inputs.${n} ]]`, `$[[inputs.${n}]]`, `$[[ inputs.${n}]]`, `$[[ inputs.${n} ]]`]);
  }

  function str(): string {
    const s = pick(STRINGS);
    return s.includes('"') ? `'${s}'` : chance(0.8) ? `"${s}"` : `'${s}'`;
  }

  function operand(allowRegex = true): string {
    const r = rnd();
    if (r < 0.42) return variable();
    if (r < 0.62) return str();
    if (r < 0.72) return 'null';
    if (r < 0.8) return pick(['true', 'false']);
    if (r < 0.88) return input();
    if (r < 0.98) return allowRegex ? regexLiteral() : variable();
    return pick(['$', '1', 'x', '@', '=', '&', '|', '~']);
  }

  function matchRhs(): string {
    const r = rnd();
    if (r < 0.55) return regexLiteral();
    if (r < 0.75) return `$${pick(['pattern1', 'pattern2', 'PAT', 'BADPAT', 'ML', 'EMPTYPAT', 'ESCAPED', 'TWOLINE', 'A', 'PLAIN', 'UNDEF1', 'EMPTY_VARIABLE', 'teststring'])}`;
    if (r < 0.87) return str();
    if (r < 0.92) return input();
    return operand();
  }

  function term(depth: number): string {
    let t: string;
    const r = rnd();
    if (r < 0.34) {
      const op = pick(['==', '!=', '=~', '!~', '=~', '!~']);
      // A regex on the left of =~ is matched against Ruby's to_s, which embeds a memory address.
      t = `${operand(!op.includes('~'))} ${op} ${op.includes('~') ? matchRhs() : operand()}`;
    } else if (r < 0.62) {
      t = operand();
    } else if (depth < 3) {
      t = `(${expr(depth + 1)})`;
    } else {
      t = operand();
    }
    if (chance(0.13)) t = `!${chance(0.5) ? t.startsWith('(') ? t : `(${t})` : t}`;
    return t;
  }

  function expr(depth: number): string {
    let e = term(depth);
    const n = chance(0.5) ? 0 : 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) e += ` ${pick(['&&', '||'])} ${term(depth)}`;
    return e;
  }

  function mutate(e: string): string {
    const r = rnd();
    const at = Math.floor(rnd() * (e.length + 1));
    if (r < 0.25) return e.slice(0, at) + e.slice(at + 1 + Math.floor(rnd() * 3));
    if (r < 0.5) return e.slice(0, at) + pick(['(', ')', '!', '&&', '||', '==', '=~', '$', '"', "'", '/', ' ', '\n', ' ', 'é', '\\', 'null', 'true']) + e.slice(at);
    if (r < 0.65) return e + pick([' &&', ' ||', ' !', ' ==', ' =~', ')', '(', ' "x"', ' $A', ' /ab/']);
    if (r < 0.8) return pick(['&& ', '|| ', '== ', ') ', '!', '']) + e;
    if (r < 0.9) return e.split(' ').reverse().join(' ');
    return e.replace(/\s+/g, pick(['', ' ', '  ', '\t', '\n']));
  }

  const rows: Row[] = [];
  for (let n = 0; n < count; n++) {
    safe = true;
    usesInputs = false;
    let e: string;
    const r = rnd();
    if (r < 0.03) {
      e = '';
      const k = Math.floor(rnd() * 6);
      for (let j = 0; j < k; j++) e += (j ? ' ' : '') + operand();
    } else if (r < 0.04) {
      e = pick(['', ' ', '\n', '   \t', '()', '( )', '!', '! !', '$', '/', '""', "''", '"', '(((', ')))', '&&', '$A $B', '$A !', 'null null', '! ! $A', '!!$A', '!($A)', '! null']);
    } else if (r < 0.045) {
      // long expressions around the 100-token limit
      const k = 45 + Math.floor(rnd() * 12);
      e = Array.from({ length: k }, () => operand()).join(pick([' && ', ' || '])).replace(/\$\{/g, '$');
    } else {
      e = expr(0);
      if (chance(0.1)) e = mutate(e);
    }
    const row: Row = { e, v: VARS, safe };
    if (usesInputs || chance(0.03)) row.i = INPUTS;
    rows.push(row);
  }
  return rows;
}

if (import.meta.main === true) {
  const count = Number(process.argv[2] ?? '12000');
  const seed = Number(process.argv[3] ?? '1');
  process.stdout.write(JSON.stringify(generateCorpus(count, seed)));
}
