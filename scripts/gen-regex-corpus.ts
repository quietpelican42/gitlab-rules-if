// Generates a seeded corpus of RE2 patterns (valid and malformed) with probe texts.
// Usage: node scripts/gen-regex-corpus.ts [count] [seed] > corpus.json

export interface RegexRow {
  p: string;
  t: string[];
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ATOMS = [
  'a', 'b', 'c', 'A', 'B', '1', '_', '-', ' ', 'é', 'K', 'K', 'ſ', 'k', 's', '.', '.', '.',
  '\\d', '\\D', '\\s', '\\S', '\\w', '\\W', '\\b', '\\B', '\\A', '\\z', '\\n', '\\t', '\\x41', '\\x{263a}', '\\101', '\\0',
  '\\pL', '\\PL', '\\p{Lu}', '\\p{Greek}', '\\p{^Nd}', '\\pN', '\\p{Ll}', '\\Q.*\\E', '\\/', '\\.', '\\_', '\\-', '\\C',
  '[a-c]', '[^a-c]', '[[:alpha:]]', '[\\d_]', '[a\\-z]', '[]a]', '[^]a]', '[\\pL\\d]', '[[:^digit:]a]', '[\\w-]', '[a-]', '[[:word:]]',
  '[^\\n]', '[\\s\\S]', '[A-Z]', '[k-s]', '[\\D]', '[^\\W]', '[[:space:]]', '[é-ü]', '[\\x00-\\x1f]',
  '^', '$', '^', '$',
];
const MALFORMED = [
  '(', ')', '[', ']', '\\', '**', '(?=a)', '(?!a)', '(?<=a)', '(?<!a)', '\\1', '\\2', 'a{2}{3}', '(?i', '{', '}', '\\8', '\\Ea', '(?#c)', '\\e',
  '\\h', '\\Z', '\\G', '\\X', '\\R', '\\cA', '[z-a]', '[a-\\d]', '[[:foo:]]', '\\p{Cn}', '\\pZ', '\\p{Foo}', '\\x{110000}', '\\x4', '(?P=n)',
  '(?P<n>a)(?P<n>b)', '(?P<1x>a)', '(?<é>a)', '(?P<>a)', '(?-)', '(?i-)', '(?x)', '{1001}', '{2,1}', '{01}', '*a', '+', '?', '|*', '(*)',
  'a{1000}', 'a{1001}', '(a{10}){101}', '((a{10}){10}){10}', '((a{10}){10}){11}', '\\pL{1000}', '.{1000}', '[[:alpha:]', '[[:alpha:', '\\Qab',
  '\\p', '\\pL{', '\\p{L', '\\p{Latn}', '\\p{Any}', '\\P{Any}', '(?U)a+', '(?s).', '(?m)^$', '(?i)ǆ', '(?i)\\w', '(?i)[^\\P{Lu}]', '(?i)\\P{Lu}', '(?i)[[:upper:]]',
];
const QUANT = ['*', '+', '?', '*?', '+?', '??', '{2}', '{2,}', '{1,3}', '{,3}', '{2}?', '{0}', '{0,0}', '{3,2}'];
const FLAGS = ['(?i)', '(?m)', '(?s)', '(?U)', '(?-i)', '(?i-m)', '(?ims)', '(?i:', '(?s:', '(?-s:'];
const TEXT_ALPHA = ['a', 'b', 'c', 'A', 'B', '1', '2', '_', '-', ' ', '\n', '\t', 'é', 'K', 'K', 'ſ', 'k', 's', 'S', 'α', 'Ω', '٣', '☺', ' ', 'ǅ', 'ǆ', '\v', '\r', '/', '.'];

export function generateRegexCorpus(count: number, seed = 1): RegexRow[] {
  return generatePatterns(count, seed).map((p, i) => ({ p, t: textsFor(p, mulberry32(seed * 7919 + i)) }));
}

function textsFor(p: string, rnd: () => number): string[] {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  const int = (n: number): number => Math.floor(rnd() * n);
  const texts = new Set<string>(['']);
  const tn = 5 + int(4);
  for (let j = 0; j < tn; j++) {
    let t = '';
    const len = int(7);
    for (let k = 0; k < len; k++) t += pick(TEXT_ALPHA);
    texts.add(t);
  }
  // a text built from the pattern's own literal characters, so matches occur
  const lit = [...p].filter((c) => /[A-Za-z0-9 _-]/.test(c)).slice(0, 6).join('');
  texts.add(lit);
  texts.add(`x${lit}\ny`);
  return [...texts];
}

/** Random RE2 patterns: a mix of valid ones and ones mutated to be malformed. */
export function generatePatterns(count: number, seed = 1): string[] {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  const int = (n: number): number => Math.floor(rnd() * n);

  function piece(depth: number): string {
    const r = rnd();
    let atom: string;
    if (r < 0.62 || depth > 2) atom = pick(ATOMS);
    else if (r < 0.72) atom = `(${alt(depth + 1)})`;
    else if (r < 0.79) atom = `(?:${alt(depth + 1)})`;
    else if (r < 0.83) atom = `(?i:${alt(depth + 1)})`;
    else if (r < 0.86) atom = `(?P<n${int(3)}>${alt(depth + 1)})`;
    else if (r < 0.88) atom = `(?<m${int(3)}>${alt(depth + 1)})`;
    else if (r < 0.94) atom = pick(FLAGS).endsWith(':') ? `${pick(FLAGS)}${alt(depth + 1)})` : pick(FLAGS);
    else atom = pick(ATOMS);
    if (rnd() < 0.3) atom += pick(QUANT);
    return atom;
  }
  function seq(depth: number): string {
    let s = '';
    const n = 1 + int(4);
    for (let i = 0; i < n; i++) s += piece(depth);
    return s;
  }
  function alt(depth: number): string {
    let s = seq(depth);
    while (rnd() < 0.2) s += `|${seq(depth)}`;
    return s;
  }

  const rows: string[] = [];
  for (let i = 0; i < count; i++) {
    let p = alt(0);
    const m = rnd();
    if (m < 0.1) p = p + pick(MALFORMED);
    else if (m < 0.16) p = pick(MALFORMED) + p;
    else if (m < 0.2) p = pick(MALFORMED);
    else if (m < 0.24 && p.length > 1) {
      const k = int(p.length);
      p = p.slice(0, k) + p.slice(k + 1); // delete one char
    } else if (m < 0.27 && p.length > 1) {
      const k = int(p.length);
      p = p.slice(0, k) + pick(['(', ')', '[', ']', '\\', '{', '}', '?', '*', '|', '^', '$', '-']) + p.slice(k);
    }
    rows.push(p);
  }
  return rows;
}

if (import.meta.main === true) {
  const count = Number(process.argv[2] ?? '6000');
  process.stdout.write(JSON.stringify(generateRegexCorpus(count, Number(process.argv[3] ?? '1'))));
}
