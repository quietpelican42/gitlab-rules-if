// Extracts test rows from GitLab's own RSpec files (fetched, pinned and hash-checked).
// The files are read at test time and never committed. The extraction is deliberately
// narrow: it understands the table and context shapes those specs use and throws on
// anything else, so a changed spec cannot pass silently.

const ESC: Record<string, string> = { n: '\n', t: '\t', r: '\r', e: '\x1b', s: ' ', a: '\x07', b: '\b', f: '\f', v: '\v', '0': '\0' };

/** Decodes a Ruby single- or double-quoted string literal (no interpolation). */
export function rubyString(lit: string): string {
  const q = lit[0];
  const body = lit.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i] as string;
    if (c !== '\\') {
      if (q === '"' && c === '#' && body[i + 1] === '{') throw new Error(`interpolation in ${lit}`);
      out += c;
      continue;
    }
    const n = body[++i] as string;
    if (q === "'") out += n === '\\' || n === "'" ? n : `\\${n}`;
    else out += ESC[n] ?? n;
  }
  return out;
}

const STR = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"`;

export type Expected = string | boolean | null;

function rubyValue(lit: string): Expected {
  const v = lit.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'nil') return null;
  if (v[0] === "'" || v[0] === '"') return rubyString(v);
  throw new Error(`unsupported Ruby value ${v}`);
}

/** Lines of the form `'expr' | value` inside the `where(...) do` block that starts at `start`. */
function tableRows(src: string, marker: RegExp, fromIndex = 0): { expr: string; value: Expected }[] {
  const m = marker.exec(src.slice(fromIndex));
  if (m === null) throw new Error(`table not found: ${marker}`);
  const start = fromIndex + m.index + m[0].length;
  const line = new RegExp(`^\\s*(${STR})\\s*\\|\\s*(${STR}|true|false|nil)\\s*$`);
  const rows: { expr: string; value: Expected }[] = [];
  for (const l of src.slice(start).split('\n')) {
    if (l.trim() === 'end') break;
    const r = line.exec(l);
    if (r) rows.push({ expr: rubyString(r[1] as string), value: rubyValue(r[2] as string) });
    else if (l.trim() !== '' && !l.includes('where(')) throw new Error(`unrecognized table line: ${l}`);
  }
  return rows;
}

export interface StatementRows {
  evaluate: { expr: string; value: Expected }[];
  inputs: { expr: string; value: Expected }[];
  truthful: { expr: string; value: Expected }[];
  patternVars: { expr: string; value: Expected }[];
  inputNames: { expr: string; names: string[]; ordered: boolean }[];
}

export function statementRows(src: string): StatementRows {
  const evalStart = src.indexOf("describe '#evaluate'");
  const inputsCtx = src.indexOf("context 'with input references'");
  const truthStart = src.indexOf("describe '#truthful?'");
  const patternsCtx = src.indexOf("context 'when variables have patterns'");
  const namesStart = src.indexOf("describe '#input_names'");
  const evaluate = tableRows(src, /where\(:expression, :value\) do\n/, evalStart);
  const inputs = tableRows(src, /where\(:expression, :value\) do\n/, inputsCtx);
  const truthful = tableRows(src, /where\(:expression, :value\) do\n/, truthStart);
  const patternVars = tableRows(src, /where\(:expression, :result\) do\n/, patternsCtx);
  // the first #evaluate table ends at the input-references context; drop the inputs rows it would otherwise include
  const inputNames: StatementRows['inputNames'] = [];
  const block = src.slice(namesStart);
  const re = new RegExp(
    String.raw`let\(:text\) \{ (${STR}) \}\s*\n\s*(?:it '[^']*' do\s*\n\s*)?(?:it \{ is_expected\.to |expect\(input_names\)\.to )(eq\(\[([^\]]*)\]\)|contain_exactly\(([^)]*)\)|be_empty)`,
    'g',
  );
  for (const m of block.matchAll(re)) {
    const list = (m[3] ?? m[4] ?? '').match(new RegExp(STR, 'g')) ?? [];
    inputNames.push({ expr: rubyString(m[1] as string), names: list.map(rubyString), ordered: m[2]?.startsWith('eq') === true });
  }
  if (inputNames.length !== 7) throw new Error(`expected 7 input_names cases, found ${inputNames.length}`);
  return { evaluate, inputs, truthful, patternVars, inputNames };
}

export function lexerRows(src: string): { expr: string; tokens: string[] }[] {
  const rows: { expr: string; tokens: string[] }[] = [];
  const re = new RegExp(String.raw`^\s*(${STR})\s*\|\s*\[((?:${STR}|[\s,])*)\]\s*$`, 'gm');
  for (const m of src.matchAll(re)) {
    rows.push({ expr: rubyString(m[1] as string), tokens: (m[2] as string).match(new RegExp(STR, 'g'))?.map(rubyString) ?? [] });
  }
  return rows;
}

export interface ParserRows {
  trees: { expr: string; tree: string }[];
  errors: { expr: string; error: string }[];
  unmatched: string[];
}

export function parserRows(src: string): ParserRows {
  const trees: ParserRows['trees'] = [];
  const line = new RegExp(`^\\s*(${STR})\\s*\\|\\s*(${STR})\\s*$`, 'gm');
  for (const m of src.matchAll(line)) trees.push({ expr: rubyString(m[1] as string), tree: rubyString(m[2] as string) });
  // subject { described_class.seed('...').tree } ... eq('...')
  const subj = new RegExp(String.raw`described_class\.seed\((${STR})\)\.tree \}[\s\S]*?\.to eq\((${STR})\)`, 'g');
  for (const m of src.matchAll(subj)) trees.push({ expr: rubyString(m[1] as string), tree: rubyString(m[2] as string) });
  const errors: ParserRows['errors'] = [];
  const err = new RegExp(String.raw`seed\((${STR})\)\.tree \}\s*\.to raise_error ([\w:]+)`, 'g');
  for (const m of src.matchAll(err)) errors.push({ expr: rubyString(m[1] as string), error: (m[2] as string).split('::').pop() as string });
  const unmatched: string[] = [];
  const at = src.indexOf("context 'when parenthesis are unmatched'");
  const arr = src.slice(at, src.indexOf('\n        ]', at));
  for (const m of arr.matchAll(new RegExp(`^\\s*(${STR}),?\\s*$`, 'gm'))) unmatched.push(rubyString(m[1] as string));
  if (trees.length !== 13 || errors.length !== 5 || unmatched.length !== 6) {
    throw new Error(`parser_spec extraction found ${trees.length} trees, ${errors.length} errors, ${unmatched.length} unmatched`);
  }
  return { trees, errors, unmatched };
}

export interface MatchCase {
  name: string;
  left: string | null;
  right: { regexp: string } | { string: string } | null;
  expected: boolean;
}

function readLeft(block: string): string | null | undefined {
  const left = /let\(:left_value\)\s*(?:\{\s*(nil|'(?:[^'\\]|\\.)*')\s*\}|do\s*\n\s*<<~TEXT\n([\s\S]*?)\n\s*TEXT\n\s*end)/.exec(block);
  if (left === null) return undefined;
  if (left[1] === 'nil') return null;
  if (left[1] !== undefined) return rubyString(left[1]);
  const lines = (left[2] as string).split('\n');
  const indent = Math.min(...lines.filter((x) => x.trim() !== '').map((x) => (/^\s*/.exec(x) as RegExpExecArray)[0].length));
  return `${lines.map((x) => x.slice(indent)).join('\n')}\n`;
}

function readRight(block: string): MatchCase['right'] | undefined {
  const right = /let\(:right_value\)\s*\{\s*(nil|Gitlab::UntrustedRegexp\.new\(('(?:[^'\\]|\\.)*')\)|'(?:[^'\\]|\\.)*')\s*\}/.exec(block);
  if (right === null) return undefined;
  if (right[1] === 'nil') return null;
  if (right[2] !== undefined) return { regexp: rubyString(right[2]) };
  return { string: rubyString(right[1] as string) };
}

/** Contexts of matches_spec.rb / not_matches_spec.rb: let(:left_value), let(:right_value), is_expected.to be(...). */
export function matchCases(src: string): MatchCase[] {
  const cases: MatchCase[] = [];
  const evalAt = src.indexOf("describe '#evaluate'");
  for (const block of src.slice(evalAt).split(/\n {4}context '/).slice(1)) {
    const name = block.slice(0, block.indexOf("'"));
    const parts = block.split(/\n {6}context '/);
    const head = parts[0] as string;
    const nested = parts.slice(1);
    const units = nested.length === 0 ? [{ label: name, body: head, ctx: head }] : nested.map((n) => ({ label: `${name} / ${n.slice(0, n.indexOf("'"))}`, body: n, ctx: head }));
    for (const u of units) {
      const exp = /is_expected\.to be\((true|false)\)/.exec(u.body);
      if (exp === null) throw new Error(`no expectation in context '${u.label}'`);
      const left = readLeft(u.body) ?? readLeft(u.ctx);
      const right = readRight(u.body) ?? readRight(u.ctx);
      if (left === undefined || right === undefined) throw new Error(`cannot read context '${u.label}'`);
      cases.push({ name: u.label, left, right, expected: exp[1] === 'true' });
    }
  }
  return cases;
}
