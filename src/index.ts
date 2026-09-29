import type { Ast, Value } from './ast.ts';
import { evaluateNode, present } from './evaluate.ts';
import type { Context, Scalar, Variables } from './evaluate.ts';
import { EvaluationCrash, ExpressionError, LexerSyntaxError, OperatorError, ParseError, StatementError } from './errors.ts';
import { tokenize } from './lexer.ts';
import type { LexemeName, Token } from './lexer.ts';
import { buildTree } from './parser.ts';
import { RegexValue } from './pattern.ts';

export { inspect } from './ast.ts';
export { present } from './evaluate.ts';
export type { Ast, BinaryType, Value } from './ast.ts';
export { EvaluationCrash, ExpressionError, LexerSyntaxError, OperatorError, ParseError, StatementError };
export { RegexpSyntaxError } from './re2/index.ts';
export { Re2 } from './re2/index.ts';
export { RegexValue, tokenize };
export type { LexemeName, Scalar, Token, Variables };

export interface EvaluateOptions {
  /** Values for `$[[ inputs.name ]]` references. */
  inputs?: Variables;
}

const EMPTY: Variables = {};

/** Parses an expression into a tree. Throws `StatementError`, `LexerSyntaxError`, `ParseError` or `OperatorError`. */
export function parse(expression: string): Ast {
  const tokens = tokenize(expression);
  if (tokens.length === 0) throw new StatementError('Gitlab::Ci::Pipeline::Expression::Statement::StatementError');
  return buildTree(tokens);
}

/** The raw value of an expression, before `present?`: a string, boolean, integer, `null` or a regex. */
export function evaluateValue(expression: string, variables: Variables = EMPTY, options: EvaluateOptions = {}): Value {
  const ctx: Context = { variables, inputs: options.inputs ?? EMPTY };
  return evaluateNode(parse(expression), ctx);
}

/**
 * The `rules:if` result: the expression's value through Ruby's `present?`.
 * Throws an `ExpressionError` where GitLab raises one (its own `truthful?` turns those into false;
 * use `truthful()` for that).
 */
export function evaluate(expression: string, variables: Variables = EMPTY, options: EvaluateOptions = {}): boolean {
  return present(evaluateValue(expression, variables, options));
}

/** GitLab's `Statement#truthful?`: `evaluate`, with any `ExpressionError` becoming false. */
export function truthful(expression: string, variables: Variables = EMPTY, options: EvaluateOptions = {}): boolean {
  try {
    return evaluate(expression, variables, options);
  } catch (e) {
    if (e instanceof ExpressionError) return false;
    throw e;
  }
}

/** GitLab's `Statement#input_names`: names referenced through `$[[ inputs.name ]]`, deduplicated. */
export function inputNames(expression: string): string[] {
  let tree: Ast;
  try {
    tree = parse(expression);
  } catch (e) {
    if (e instanceof ExpressionError) return [];
    throw e;
  }
  const names: string[] = [];
  const walk = (n: Ast): void => {
    if (n.type === 'input') names.push(n.name);
    else if ('left' in n) {
      walk(n.left);
      walk(n.right);
    }
  };
  walk(tree);
  return [...new Set(names)];
}
