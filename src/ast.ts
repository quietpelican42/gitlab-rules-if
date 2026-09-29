import type { RegexValue } from './pattern.ts';

export type BinaryType = 'equals' | 'notEquals' | 'matches' | 'notMatches' | 'and' | 'or';

export type Ast =
  | { type: 'variable'; name: string }
  | { type: 'input'; name: string }
  | { type: 'string'; value: string }
  | { type: 'pattern'; value: string; regex: RegexValue }
  | { type: 'null' }
  | { type: 'boolean'; value: boolean }
  | { type: 'not'; operand: Ast }
  | { type: BinaryType; left: Ast; right: Ast };

/** What an expression evaluates to. `null` is Ruby's nil. */
export type Value = string | number | boolean | null | RegexValue;

const ESCAPES: Record<string, string> = {
  '"': '\\"', '\\': '\\\\', '\n': '\\n', '\t': '\\t', '\r': '\\r', '\x1b': '\\e', '\x07': '\\a', '\b': '\\b', '\f': '\\f', '\v': '\\v',
};

function rubyInspect(s: string): string {
  let out = '"';
  const cps = Array.from(s);
  cps.forEach((ch, i) => {
    const e = ESCAPES[ch];
    if (e !== undefined) out += e;
    else if (ch === '#' && ['{', '$', '@'].includes(cps[i + 1] ?? '')) out += '\\#';
    else if (ch.charCodeAt(0) < 0x20 || ch === '\x7f') out += `\\x${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
    else out += ch;
  });
  return `${out}"`;
}

/** Renders a tree the way GitLab's `Lexeme#inspect` does, e.g. `and($A, or($B, "x"))`. */
export function inspect(ast: Ast): string {
  switch (ast.type) {
    case 'variable': return `$${ast.name}`;
    case 'input': return `$[[ inputs.${ast.name} ]]`;
    case 'string': return rubyInspect(ast.value);
    case 'pattern': return `/${ast.value}/`;
    case 'null': return 'null';
    case 'boolean': return String(ast.value);
    case 'not': return `not(${inspect(ast.operand)})`;
    default: {
      const name = ast.type === 'notEquals' ? 'not_equals' : ast.type === 'notMatches' ? 'not_matches' : ast.type;
      return `${name}(${inspect(ast.left)}, ${inspect(ast.right)})`;
    }
  }
}
