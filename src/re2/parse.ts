// A parser for the RE2 pattern syntax as compiled by the `re2` gem with default
// options (Perl-like flags, UTF-8). It follows the structure of RE2's parse.cc so
// that the same patterns are rejected. It produces an AST, not a matcher.

import { foldOrbit, lookupProperty } from './unicode.ts';

export class RegexpSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegexpSyntaxError';
  }
}

export type Item =
  | { k: 'r'; lo: number; hi: number }
  | { k: 'perl'; c: 'd' | 's' | 'w'; neg: boolean }
  | { k: 'posix'; name: string; neg: boolean }
  | { k: 'p'; name: string; neg: boolean };

export type Node =
  | { t: 'lit'; cps: number[] }
  | { t: 'any'; nl: boolean }
  | { t: 'anybyte' }
  | { t: 'cls'; items: Item[]; neg: boolean; fold: boolean }
  | { t: 'assert'; k: 'bol' | 'eol' | 'bot' | 'eot' | 'wb' | 'nwb' }
  | { t: 'cat'; subs: Node[] }
  | { t: 'alt'; subs: Node[] }
  | { t: 'rep'; sub: Node; min: number; max: number }
  | { t: 'cap'; sub: Node };

export interface Parsed {
  node: Node;
  captures: number;
}

const MAX_REPEAT = 1000;
// RE2 has no fixed nesting limit; this parser is recursive, so it keeps its own.
const MAX_DEPTH = 1000;

export const POSIX_NAMES = new Set([
  'alnum', 'alpha', 'ascii', 'blank', 'cntrl', 'digit', 'graph', 'lower', 'print', 'punct', 'space', 'upper', 'word', 'xdigit',
]);

const code = (c: string): number => c.charCodeAt(0);
const isOctal = (c: number): boolean => c >= 48 && c <= 55;
const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isHex = (c: number): boolean => isDigit(c) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
const unHex = (c: number): number => (isDigit(c) ? c - 48 : (c | 32) - 97 + 10);
const isAlnumAscii = (c: number): boolean => isDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

interface Flags {
  i: boolean;
  oneLine: boolean;
  dotNL: boolean;
}

function walkRepeat(n: Node, arg: number): number {
  let a = arg;
  if (n.t === 'rep') {
    const m = n.max < 0 ? n.min : n.max;
    if (m > 0) a = Math.trunc(a / m);
  }
  let r = a;
  const kids: Node[] = n.t === 'cat' || n.t === 'alt' ? n.subs : n.t === 'rep' || n.t === 'cap' ? [n.sub] : [];
  for (const k of kids) r = Math.min(r, walkRepeat(k, a));
  return r;
}

const captureNameOk = /^[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}]+$/u;

class Parser {
  s: number[];
  pos = 0;
  flags: Flags = { i: false, oneLine: true, dotNL: false };
  captures = 0;

  constructor(pattern: string) {
    this.s = Array.from(pattern, (ch) => ch.codePointAt(0) as number);
  }

  err(msg: string): never {
    throw new RegexpSyntaxError(msg);
  }

  peek(off = 0): number {
    return this.s[this.pos + off] ?? -1;
  }

  lit(cp: number): Node {
    if (this.flags.i) {
      const orbit = foldOrbit(cp);
      if (orbit.length > 1) return { t: 'lit', cps: orbit };
    }
    return { t: 'lit', cps: [cp] };
  }

  cat(items: Node[]): Node {
    return items.length === 1 ? (items[0] as Node) : { t: 'cat', subs: items };
  }

  parseAlt(depth: number): Node {
    const branches: Node[] = [];
    let cur: Node[] = [];
    let lastRepeat = false;
    const s = this.s;
    while (this.pos < s.length) {
      const c = s[this.pos] as number;
      const wasRepeat = lastRepeat;
      lastRepeat = false;
      if (c === code('|')) {
        branches.push(this.cat(cur));
        cur = [];
        this.pos++;
      } else if (c === code(')')) {
        if (depth === 0) this.err('unexpected ): missing (');
        break;
      } else if (c === code('(')) {
        this.parseGroup(depth, cur);
      } else if (c === code('*') || c === code('+') || c === code('?')) {
        this.pos++;
        if (this.peek() === code('?')) this.pos++;
        if (wasRepeat) this.err('bad repetition operator');
        const min = c === code('+') ? 1 : 0;
        const max = c === code('?') ? 1 : -1;
        if (cur.length === 0) this.err('missing argument to repetition operator');
        cur.push({ t: 'rep', sub: cur.pop() as Node, min, max });
        lastRepeat = true;
      } else if (c === code('{')) {
        const rep = this.maybeRepeat();
        if (rep === undefined) {
          cur.push(this.lit(c));
          this.pos++;
        } else {
          if (this.peek() === code('?')) this.pos++;
          if (wasRepeat) this.err('bad repetition operator');
          const [min, max] = rep;
          if ((max !== -1 && max < min) || min > MAX_REPEAT || max > MAX_REPEAT) this.err('invalid repetition size');
          if (cur.length === 0) this.err('missing argument to repetition operator');
          const node: Node = { t: 'rep', sub: cur.pop() as Node, min, max };
          if ((min >= 2 || max >= 2) && walkRepeat(node, MAX_REPEAT) === 0) this.err('invalid repetition size');
          cur.push(node);
          lastRepeat = true;
        }
      } else if (c === code('.')) {
        cur.push({ t: 'any', nl: this.flags.dotNL });
        this.pos++;
      } else if (c === code('^')) {
        cur.push({ t: 'assert', k: this.flags.oneLine ? 'bot' : 'bol' });
        this.pos++;
      } else if (c === code('$')) {
        cur.push({ t: 'assert', k: this.flags.oneLine ? 'eot' : 'eol' });
        this.pos++;
      } else if (c === code('[')) {
        cur.push(this.parseClass());
      } else if (c === code('\\')) {
        this.parseBackslash(cur);
      } else {
        cur.push(this.lit(c));
        this.pos++;
      }
    }
    branches.push(this.cat(cur));
    return branches.length === 1 ? (branches[0] as Node) : { t: 'alt', subs: branches };
  }

  parseGroup(depth: number, cur: Node[]): void {
    const s = this.s;
    const saved = { ...this.flags };
    let capture = true;
    this.pos++; // (
    if (this.peek() === code('?')) {
      // (?flags) / (?flags:re) / (?P<name>re) / (?<name>re)
      const c2 = this.peek(1);
      const c3 = this.peek(2);
      if (c2 === code('=') || c2 === code('!') || (c2 === code('<') && (c3 === code('=') || c3 === code('!')))) {
        this.err('invalid perl operator: lookaround is not supported');
      }
      if (c2 === code('P') || c2 === code('<')) {
        const begin = this.pos + (c2 === code('P') ? 3 : 2);
        if (c2 === code('P') && c3 !== code('<')) this.err('invalid named capture');
        let end = begin;
        while (end < s.length && s[end] !== code('>')) end++;
        if (end >= s.length) this.err('invalid named capture');
        const name = String.fromCodePoint(...s.slice(begin, end));
        if (!captureNameOk.test(name)) this.err(`invalid named capture: ${name}`);
        this.pos = end + 1;
      } else {
        this.pos++; // ?
        let negated = false;
        let sawFlag = false;
        const flags = { ...this.flags };
        let done = false;
        let isGroup = false;
        while (!done) {
          if (this.pos >= s.length) this.err('missing closing ): invalid perl operator');
          const f = s[this.pos++] as number;
          if (f === code('i')) {
            sawFlag = true;
            flags.i = !negated;
          } else if (f === code('m')) {
            sawFlag = true;
            flags.oneLine = negated;
          } else if (f === code('s')) {
            sawFlag = true;
            flags.dotNL = !negated;
          } else if (f === code('U')) {
            sawFlag = true;
          } else if (f === code('-')) {
            if (negated) this.err('invalid perl operator');
            negated = true;
            sawFlag = false;
          } else if (f === code(':')) {
            isGroup = true;
            done = true;
          } else if (f === code(')')) {
            done = true;
          } else {
            this.err('invalid perl operator');
          }
        }
        if (negated && !sawFlag) this.err('invalid perl operator');
        this.flags = flags;
        if (!isGroup) return; // flags apply to the rest of the enclosing group
        capture = false;
      }
    }
    if (depth + 1 > MAX_DEPTH) this.err('nesting depth exceeded');
    if (capture) this.captures++;
    const inner = this.parseAlt(depth + 1);
    if (this.pos >= s.length || s[this.pos] !== code(')')) this.err('missing ): unclosed group');
    this.pos++;
    this.flags = saved;
    cur.push(capture ? { t: 'cap', sub: inner } : inner);
  }

  maybeRepeat(): [number, number] | undefined {
    const s = this.s;
    let p = this.pos + 1;
    const int = (): number | undefined => {
      if (p >= s.length || !isDigit(s[p] as number)) return undefined;
      if (s[p] === 48 && p + 1 < s.length && isDigit(s[p + 1] as number)) return undefined;
      let n = 0;
      while (p < s.length && isDigit(s[p] as number)) {
        if (n >= 100000000) n = 100000000;
        else n = n * 10 + ((s[p] as number) - 48);
        p++;
      }
      return n;
    };
    const lo = int();
    if (lo === undefined || p >= s.length) return undefined;
    let hi = lo;
    if (s[p] === code(',')) {
      p++;
      if (p >= s.length) return undefined;
      if (s[p] === code('}')) hi = -1;
      else {
        const h = int();
        if (h === undefined) return undefined;
        hi = h;
      }
    }
    if (p >= s.length || s[p] !== code('}')) return undefined;
    this.pos = p + 1;
    return [lo, hi];
  }

  escape(): number {
    const s = this.s;
    if (this.pos + 1 >= s.length) this.err('trailing backslash at end of expression');
    const c = s[this.pos + 1] as number;
    this.pos += 2;
    const bad = (): never => this.err('invalid escape sequence');
    if (c >= 49 && c <= 55 && !isOctal(this.peek())) bad();
    if (c >= 48 && c <= 55) {
      let v = c - 48;
      for (let i = 0; i < 2 && isOctal(this.peek()); i++) v = v * 8 + (s[this.pos++] as number) - 48;
      return v;
    }
    if (c === code('x')) {
      if (this.pos >= s.length) bad();
      let h = s[this.pos++] as number;
      if (h === code('{')) {
        if (this.pos >= s.length) bad();
        h = s[this.pos++] as number;
        let n = 0;
        let v = 0;
        while (isHex(h)) {
          n++;
          v = v * 16 + unHex(h);
          if (v > 0x10ffff) bad();
          if (this.pos >= s.length) bad();
          h = s[this.pos++] as number;
        }
        if (h !== code('}') || n === 0) bad();
        return v;
      }
      if (this.pos >= s.length) bad();
      const h2 = s[this.pos++] as number;
      if (!isHex(h) || !isHex(h2)) bad();
      return unHex(h) * 16 + unHex(h2);
    }
    switch (c) {
      case 110: return 10; // n
      case 114: return 13; // r
      case 116: return 9; // t
      case 97: return 7; // a
      case 102: return 12; // f
      case 118: return 11; // v
      default:
    }
    if (c < 0x80 && !isAlnumAscii(c)) return c;
    return bad();
  }

  /** `\pN`, `\p{Name}`, `\PN`, `\p{^Name}` at pos. Returns undefined if not a property escape. */
  unicodeGroup(): Item | undefined {
    const s = this.s;
    if (s[this.pos] !== code('\\')) return undefined;
    const c = s[this.pos + 1];
    if (c !== code('p') && c !== code('P')) return undefined;
    let neg = c === code('P');
    this.pos += 2;
    if (this.pos >= s.length) this.err('invalid character class range');
    let name: string;
    const first = s[this.pos++] as number;
    if (first !== code('{')) name = String.fromCodePoint(first);
    else {
      let end = this.pos;
      while (end < s.length && s[end] !== code('}')) end++;
      if (end >= s.length) this.err('invalid character class range');
      name = String.fromCodePoint(...s.slice(this.pos, end));
      this.pos = end + 1;
    }
    if (name.startsWith('^')) {
      neg = !neg;
      name = name.slice(1);
    }
    if (lookupProperty(name) === undefined) this.err(`invalid character class range: ${name}`);
    return { k: 'p', name, neg };
  }

  perlClass(): Item | undefined {
    if (this.peek() !== code('\\')) return undefined;
    const c = this.peek(1);
    const ch = c < 0 ? '' : String.fromCodePoint(c);
    if ('dDsSwW'.includes(ch) && ch !== '') {
      this.pos += 2;
      return { k: 'perl', c: ch.toLowerCase() as 'd' | 's' | 'w', neg: ch !== ch.toLowerCase() };
    }
    return undefined;
  }

  parseClass(): Node {
    const s = this.s;
    this.pos++; // [
    let neg = false;
    if (this.peek() === code('^')) {
      neg = true;
      this.pos++;
    }
    const items: Item[] = [];
    let first = true;
    while (this.pos < s.length && (s[this.pos] !== code(']') || first)) {
      first = false;
      if (s.length - this.pos > 2 && s[this.pos] === code('[') && s[this.pos + 1] === code(':')) {
        let end = this.pos + 2;
        while (end + 1 < s.length && !(s[end] === code(':') && s[end + 1] === code(']'))) end++;
        if (end + 1 < s.length) {
          let name = String.fromCodePoint(...s.slice(this.pos + 2, end));
          let pneg = false;
          if (name.startsWith('^')) {
            pneg = true;
            name = name.slice(1);
          }
          if (!POSIX_NAMES.has(name)) this.err('invalid character class range');
          items.push({ k: 'posix', name, neg: pneg });
          this.pos = end + 2;
          continue;
        }
      }
      if (s.length - this.pos > 2 && s[this.pos] === code('\\') && (s[this.pos + 1] === code('p') || s[this.pos + 1] === code('P'))) {
        const it = this.unicodeGroup();
        if (it) {
          items.push(it);
          continue;
        }
      }
      const pc = this.perlClass();
      if (pc) {
        items.push(pc);
        continue;
      }
      const lo = this.ccChar();
      let hi = lo;
      if (s.length - this.pos >= 2 && s[this.pos] === code('-') && s[this.pos + 1] !== code(']')) {
        this.pos++;
        hi = this.ccChar();
        if (hi < lo) this.err('invalid character class range');
      }
      items.push({ k: 'r', lo, hi });
    }
    if (this.pos >= s.length) this.err('missing ]');
    this.pos++; // ]
    return { t: 'cls', items, neg, fold: this.flags.i };
  }

  ccChar(): number {
    if (this.pos >= this.s.length) this.err('missing ]');
    if (this.s[this.pos] === code('\\')) return this.escape();
    return this.s[this.pos++] as number;
  }

  parseBackslash(cur: Node[]): void {
    const s = this.s;
    const c = this.peek(1);
    if (c === code('b') || c === code('B')) {
      cur.push({ t: 'assert', k: c === code('b') ? 'wb' : 'nwb' });
      this.pos += 2;
      return;
    }
    if (c === code('A')) {
      cur.push({ t: 'assert', k: 'bot' });
      this.pos += 2;
      return;
    }
    if (c === code('z')) {
      cur.push({ t: 'assert', k: 'eot' });
      this.pos += 2;
      return;
    }
    if (c === code('C')) {
      cur.push({ t: 'anybyte' });
      this.pos += 2;
      return;
    }
    if (c === code('Q')) {
      this.pos += 2;
      while (this.pos < s.length) {
        if (s[this.pos] === code('\\') && s[this.pos + 1] === code('E')) {
          this.pos += 2;
          break;
        }
        cur.push(this.lit(s[this.pos++] as number));
      }
      return;
    }
    if (c === code('p') || c === code('P')) {
      const it = this.unicodeGroup();
      if (it) {
        cur.push({ t: 'cls', items: [it], neg: false, fold: this.flags.i });
        return;
      }
    }
    const pc = this.perlClass();
    if (pc) {
      cur.push({ t: 'cls', items: [pc], neg: false, fold: this.flags.i });
      return;
    }
    cur.push(this.lit(this.escape()));
  }
}

/** Parses an RE2 pattern; throws RegexpSyntaxError where RE2 reports an error. */
export function parseRe2(pattern: string): Parsed {
  const p = new Parser(pattern);
  const node = p.parseAlt(0);
  return { node, captures: p.captures };
}
