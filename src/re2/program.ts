// Compiles the RE2 AST to a small NFA program and runs it with a state-set
// simulation (no backtracking), so matching is linear in the text length.
// Only "does the pattern match anywhere in the text" is answered.

import type { Item, Node } from './parse.ts';
import { foldOrbit, lookupProperty } from './unicode.ts';
import { RegexpSyntaxError } from './parse.ts';

type Pred = (cp: number) => boolean;

const OP_CHAR = 0;
const OP_SPLIT = 1;
const OP_JMP = 2;
const OP_ASSERT = 3;
const OP_MATCH = 4;

const ASSERT_IDS = { bol: 0, eol: 1, bot: 2, eot: 3, wb: 4, nwb: 5 } as const;

// RE2 rejects programs above about 87 381 instructions with its default 8 MB budget
// ("pattern too large"). Its UTF-8 compiler is not reproduced. Instead each instruction
// costs 1 and the classes that compile to hundreds of instructions carry a weight
// calibrated by probing Google RE2: the largest n for which \p{X}{n} still compiles.
const BUDGET = 87_381;
const MAX_INSTRUCTIONS = 200_000;
const PROPERTY_MAX_REPEAT: Record<string, number> = { L: 446, Ll: 756, Lo: 558, Lu: 788, M: 965, Mn: 934 };

function classCost(items: Item[]): number {
  let cost = 0;
  for (const it of items) {
    const n = it.k === 'p' ? PROPERTY_MAX_REPEAT[it.name] : undefined;
    cost += n === undefined ? 0 : BUDGET / (n + 0.5) - 1;
  }
  return cost;
}

const isWordCp = (cp: number): boolean =>
  cp >= 0 && ((cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || cp === 95);

function posixMatch(name: string, c: number): boolean {
  switch (name) {
    case 'alnum': return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    case 'alpha': return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    case 'ascii': return c <= 0x7f;
    case 'blank': return c === 9 || c === 32;
    case 'cntrl': return c <= 0x1f || c === 0x7f;
    case 'digit': return c >= 48 && c <= 57;
    case 'graph': return c >= 0x21 && c <= 0x7e;
    case 'lower': return c >= 97 && c <= 122;
    case 'print': return c >= 0x20 && c <= 0x7e;
    case 'punct': return (c >= 0x21 && c <= 0x2f) || (c >= 0x3a && c <= 0x40) || (c >= 0x5b && c <= 0x60) || (c >= 0x7b && c <= 0x7e);
    case 'space': return c === 32 || (c >= 9 && c <= 13);
    case 'upper': return c >= 65 && c <= 90;
    case 'word': return isWordCp(c);
    default: return c >= 48 && c <= 57 || (c >= 65 && c <= 70) || (c >= 97 && c <= 102); // xdigit
  }
}

function basePred(it: Item): Pred {
  switch (it.k) {
    case 'r': {
      const { lo, hi } = it;
      return (c) => c >= lo && c <= hi;
    }
    case 'perl':
      if (it.c === 'd') return (c) => c >= 48 && c <= 57;
      if (it.c === 's') return (c) => c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
      return isWordCp;
    case 'posix': {
      const name = it.name;
      return (c) => posixMatch(name, c);
    }
    case 'p':
      return lookupProperty(it.name) as Pred;
  }
}

function itemPred(it: Item, fold: boolean): Pred {
  const base = basePred(it);
  const neg = it.k !== 'r' && it.neg;
  if (!fold) return neg ? (c) => !base(c) : base;
  const closed: Pred = (c) => foldOrbit(c).some(base);
  return neg ? (c) => !closed(c) : closed;
}

function classPred(items: Item[], neg: boolean, fold: boolean): Pred {
  const preds = items.map((it) => itemPred(it, fold));
  return neg ? (c) => !preds.some((p) => p(c)) : (c) => preds.some((p) => p(c));
}

export class Program {
  op: number[] = [];
  x: number[] = [];
  y: number[] = [];
  preds: Pred[] = [];
  private cost = 0;

  private emit(op: number, x = 0, y = 0): number {
    this.cost++;
    if (this.op.length >= MAX_INSTRUCTIONS || this.cost > BUDGET) throw new RegexpSyntaxError('pattern too large - compile failed');
    this.op.push(op);
    this.x.push(x);
    this.y.push(y);
    return this.op.length - 1;
  }

  private char(p: Pred, extraCost = 0): void {
    this.cost += extraCost;
    this.preds.push(p);
    this.emit(OP_CHAR, this.preds.length - 1);
  }

  compile(n: Node): void {
    switch (n.t) {
      case 'lit': {
        const cps = n.cps;
        if (cps.length === 1) {
          const only = cps[0] as number;
          this.char((c) => c === only);
        } else this.char((c) => cps.includes(c));
        return;
      }
      case 'any':
        this.char(n.nl ? () => true : (c) => c !== 10);
        return;
      case 'anybyte':
        this.char(() => true);
        return;
      case 'cls':
        this.char(classPred(n.items, n.neg, n.fold), classCost(n.items));
        return;
      case 'assert':
        this.emit(OP_ASSERT, ASSERT_IDS[n.k]);
        return;
      case 'cat':
        for (const s of n.subs) this.compile(s);
        return;
      case 'cap':
        this.compile(n.sub);
        return;
      case 'alt': {
        const jumps: number[] = [];
        n.subs.forEach((s, i) => {
          if (i < n.subs.length - 1) {
            const split = this.emit(OP_SPLIT);
            this.x[split] = this.op.length;
            this.compile(s);
            jumps.push(this.emit(OP_JMP));
            this.y[split] = this.op.length;
          } else this.compile(s);
        });
        for (const j of jumps) this.x[j] = this.op.length;
        return;
      }
      case 'rep': {
        for (let i = 0; i < n.min; i++) this.compile(n.sub);
        if (n.max < 0) {
          const split = this.emit(OP_SPLIT);
          this.x[split] = this.op.length;
          this.compile(n.sub);
          this.emit(OP_JMP, split);
          this.y[split] = this.op.length;
        } else {
          const splits: number[] = [];
          for (let i = n.min; i < n.max; i++) {
            const split = this.emit(OP_SPLIT);
            this.x[split] = this.op.length;
            splits.push(split);
            this.compile(n.sub);
          }
          for (const s of splits) this.y[s] = this.op.length;
        }
        return;
      }
    }
  }

  build(root: Node): this {
    this.compile(root);
    this.emit(OP_MATCH);
    return this;
  }

  /** True if the pattern matches anywhere in the code points `cps`. */
  test(cps: number[]): boolean {
    const n = cps.length;
    const size = this.op.length;
    let cur = new Int32Array(size);
    let next = new Int32Array(size);
    let curMark = new Int32Array(size).fill(-1);
    let nextMark = new Int32Array(size).fill(-1);
    let curN = 0;
    let nextN = 0;
    const stack: number[] = [];

    // RE2 runs on UTF-8 bytes and starts a search at every byte offset, so a "not a word
    // boundary" (\B) also holds inside a multi-byte character. `virt` models such a position.
    let virt = false;
    const assertOk = (id: number, pos: number): boolean => {
      if (virt) return id === 5;
      const prev = pos > 0 ? (cps[pos - 1] as number) : -1;
      const nxt = pos < n ? (cps[pos] as number) : -1;
      switch (id) {
        case 0: return pos === 0 || prev === 10;
        case 1: return pos === n || nxt === 10;
        case 2: return pos === 0;
        case 3: return pos === n;
        case 4: return isWordCp(prev) !== isWordCp(nxt);
        default: return isWordCp(prev) === isWordCp(nxt);
      }
    };

    // Adds the epsilon closure of `pc` at `pos` to the list. Returns true on MATCH.
    const add = (pc0: number, pos: number, list: Int32Array, marks: Int32Array, count: number, gen: number): number => {
      stack.push(pc0);
      while (stack.length > 0) {
        const pc = stack.pop() as number;
        if (marks[pc] === gen) continue;
        marks[pc] = gen;
        switch (this.op[pc]) {
          case OP_JMP:
            stack.push(this.x[pc] as number);
            break;
          case OP_SPLIT:
            stack.push(this.y[pc] as number);
            stack.push(this.x[pc] as number);
            break;
          case OP_ASSERT:
            if (assertOk(this.x[pc] as number, pos)) stack.push(pc + 1);
            break;
          case OP_MATCH:
            stack.length = 0;
            return -1;
          default:
            list[count++] = pc;
        }
      }
      return count;
    };

    const hasNwb = this.op.some((o, i) => o === OP_ASSERT && this.x[i] === 5);
    const vList = new Int32Array(hasNwb ? size : 0);
    const vMark = new Int32Array(hasNwb ? size : 0).fill(-1);
    let vGen = 0;

    for (let pos = 0; pos <= n; pos++) {
      if (hasNwb && pos < n && (cps[pos] as number) > 0x7f) {
        virt = true;
        const rv = add(0, pos, vList, vMark, 0, vGen++);
        virt = false;
        if (rv < 0) return true;
      }
      const r = add(0, pos, cur, curMark, curN, pos);
      if (r < 0) return true;
      curN = r;
      if (pos === n) break;
      const c = cps[pos] as number;
      nextN = 0;
      for (let i = 0; i < curN; i++) {
        const pc = cur[i] as number;
        if ((this.preds[this.x[pc] as number] as Pred)(c)) {
          const r2 = add(pc + 1, pos + 1, next, nextMark, nextN, pos + 1);
          if (r2 < 0) return true;
          nextN = r2;
        }
      }
      [cur, next] = [next, cur];
      [curMark, nextMark] = [nextMark, curMark];
      curN = nextN;
    }
    return false;
  }
}
