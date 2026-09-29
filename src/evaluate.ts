// Port of the `evaluate` methods of the lexemes (Ruby semantics: only nil and
// false are falsy inside && and ||; the final result goes through `present?`).
// Derived from GitLab, Copyright (c) 2011-present GitLab Inc. (MIT Expat); see LICENSE-gitlab.

import type { Ast, Value } from './ast.ts';
import { EvaluationCrash, LexerSyntaxError } from './errors.ts';
import { buildPattern, RegexValue } from './pattern.ts';

export type Scalar = string | number | boolean | null | undefined;
export type Variables = Readonly<Record<string, Scalar>> | ReadonlyMap<string, Scalar>;

export interface Context {
  variables: Variables;
  inputs: Variables;
}

// Ruby's `Object#to_s` on an UntrustedRegexp includes an address that cannot be reproduced.
const REGEX_TO_S = '#<Gitlab::UntrustedRegexp:0x0000000000000000>';

const WHITE_SPACE = /^\p{White_Space}*$/u;

/** ActiveSupport's `present?` for the value kinds an expression can produce. */
export function present(v: Value): boolean {
  if (v === null || v === false) return false;
  if (typeof v === 'string') return !(v === '' || WHITE_SPACE.test(v));
  return true;
}

function toS(v: Value): string {
  if (v === null) return '';
  if (v instanceof RegexValue) return REGEX_TO_S;
  return String(v);
}

function lookup(map: Variables, name: string): Value {
  let v: Scalar;
  if (map instanceof Map) v = map.get(name);
  else v = Object.hasOwn(map, name) ? (map as Readonly<Record<string, Scalar>>)[name] : undefined;
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v;
  throw new TypeError(`Unsupported value for "${name}": expected string, boolean, integer or null`);
}

function isBool(v: Value): v is boolean {
  return typeof v === 'boolean';
}

function equalWithCoercion(l: Value, r: Value): boolean {
  if ((isBool(l) && typeof r === 'string') || (typeof l === 'string' && isBool(r))) {
    return String(l) === String(r);
  }
  if (l instanceof RegexValue) {
    if (r instanceof RegexValue) return l.source === r.source;
    throw new EvaluationCrash(`undefined method 'source' for ${r === null ? 'nil' : typeof r}`);
  }
  if (r instanceof RegexValue) {
    if (typeof l === 'number') throw new EvaluationCrash("undefined method 'source' for an instance of Integer");
    return false;
  }
  return l === r;
}

/** `Pattern.build_and_evaluate`: a regex if the string is /re/flags, otherwise the string itself. */
function patternOrString(data: Value): RegexValue | string {
  if (data instanceof RegexValue) return data;
  if (typeof data !== 'string') {
    throw new EvaluationCrash(`undefined method 'gsub' for ${String(data)}`);
  }
  try {
    return buildPattern(data).regex;
  } catch (e) {
    if (e instanceof LexerSyntaxError) return data;
    throw e;
  }
}

function scanFinds(regexp: RegexValue | string, text: string): boolean {
  // A String receiver falls back to String#scan(text): a literal substring search.
  return regexp instanceof RegexValue ? regexp.re.scanFinds(text) : regexp.includes(text);
}

export function evaluateNode(node: Ast, ctx: Context): Value {
  switch (node.type) {
    case 'variable':
      return lookup(ctx.variables, node.name);
    case 'input':
      return lookup(ctx.inputs, node.name);
    case 'string':
      return node.value;
    case 'pattern':
      return node.regex;
    case 'null':
      return null;
    case 'boolean':
      return node.value;
    case 'not':
      return !present(evaluateNode(node.operand, ctx));
    case 'and': {
      const l = evaluateNode(node.left, ctx);
      return l === null || l === false ? l : evaluateNode(node.right, ctx);
    }
    case 'or': {
      const l = evaluateNode(node.left, ctx);
      return l === null || l === false ? evaluateNode(node.right, ctx) : l;
    }
    case 'equals':
      return equalWithCoercion(evaluateNode(node.left, ctx), evaluateNode(node.right, ctx));
    case 'notEquals':
      return !equalWithCoercion(evaluateNode(node.left, ctx), evaluateNode(node.right, ctx));
    case 'matches':
    case 'notMatches': {
      const text = evaluateNode(node.left, ctx);
      const regexp = evaluateNode(node.right, ctx);
      if (regexp === null || regexp === false) return node.type === 'notMatches';
      const found = scanFinds(patternOrString(regexp), toS(text));
      return node.type === 'matches' ? found : !found;
    }
  }
}
