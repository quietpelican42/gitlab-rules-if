// Port of lib/gitlab/ci/pipeline/expression/parser.rb (shunting-yard to RPN, then a tree).
// Derived from GitLab, Copyright (c) 2011-present GitLab Inc. (MIT Expat); see LICENSE-gitlab.

import type { Ast, BinaryType } from './ast.ts';
import { OperatorError, ParseError } from './errors.ts';
import type { LexemeName, Token } from './lexer.ts';
import { buildPattern } from './pattern.ts';

type Kind = 'value' | 'unary_operator' | 'logical_operator' | 'parenthesis_open' | 'parenthesis_close';

const KIND: Record<LexemeName, Kind> = {
  parenthesisopen: 'parenthesis_open',
  parenthesisclose: 'parenthesis_close',
  input: 'value',
  variable: 'value',
  string: 'value',
  pattern: 'value',
  null: 'value',
  boolean: 'value',
  equals: 'logical_operator',
  matches: 'logical_operator',
  notequals: 'logical_operator',
  notmatches: 'logical_operator',
  and: 'logical_operator',
  or: 'logical_operator',
  not: 'unary_operator',
};

const PRECEDENCE: Partial<Record<LexemeName, number>> = {
  or: 12,
  and: 11,
  equals: 10,
  notequals: 10,
  matches: 10,
  notmatches: 10,
  not: 1,
  parenthesisclose: 900,
  parenthesisopen: 901,
};

const BINARY: Partial<Record<LexemeName, BinaryType>> = {
  equals: 'equals',
  notequals: 'notEquals',
  matches: 'matches',
  notmatches: 'notMatches',
  and: 'and',
  or: 'or',
};

function consumes(token: Token, top: Token | undefined): boolean {
  return top !== undefined && (PRECEDENCE[token.lexeme] as number) >= (PRECEDENCE[top.lexeme] as number);
}

function toRpn(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const operators: Token[] = [];
  for (const token of tokens) {
    switch (KIND[token.lexeme]) {
      case 'value':
        output.push(token);
        break;
      case 'logical_operator':
        while (consumes(token, operators[operators.length - 1])) output.push(operators.pop() as Token);
        operators.push(token);
        break;
      case 'parenthesis_open':
      case 'unary_operator':
        operators.push(token);
        break;
      case 'parenthesis_close': {
        while (consumes(token, operators[operators.length - 1])) output.push(operators.pop() as Token);
        const top = operators[operators.length - 1];
        if (top === undefined) throw new ParseError('Unmatched parenthesis');
        if (top.lexeme === 'parenthesisopen') operators.pop();
        break;
      }
    }
  }
  return output.concat(operators.reverse());
}

function buildValue(token: Token): Ast {
  const v = token.value;
  switch (token.lexeme) {
    case 'variable':
      return { type: 'variable', name: v.slice(1) };
    case 'input':
      return { type: 'input', name: /inputs\.([\w-]+)/.exec(v)?.[1] as string };
    case 'string':
      return { type: 'string', value: v.slice(1, -1) };
    case 'pattern': {
      const { value, regex } = buildPattern(v);
      return { type: 'pattern', value, regex };
    }
    case 'null':
      return { type: 'null' };
    default:
      return { type: 'boolean', value: v === 'true' };
  }
}

/** Builds the tree for a token list; errors match GitLab's `Parser#tree`. */
export function buildTree(tokens: Token[]): Ast {
  const results: Ast[] = [];
  for (const token of toRpn(tokens)) {
    const kind = KIND[token.lexeme];
    if (kind === 'value') {
      results.push(buildValue(token));
    } else if (kind === 'unary_operator') {
      const operand = results.pop();
      if (operand === undefined) throw new OperatorError('Invalid operand');
      results.push({ type: 'not', operand });
    } else if (kind === 'logical_operator') {
      const right = results.pop();
      const left = results.pop();
      if (left === undefined) throw new OperatorError('Invalid left operand');
      if (right === undefined) throw new OperatorError('Invalid right operand');
      results.push({ type: BINARY[token.lexeme] as BinaryType, left, right });
    } else {
      throw new ParseError(`Unprocessable token found in parse tree: ${kind}`);
    }
  }
  if (results.length > 1) throw new ParseError('Unreachable nodes in parse tree');
  if (results.length < 1) throw new ParseError('Empty parse tree');
  return results[0] as Ast;
}
