// Shared by the fixture test and the live oracle test: runs a corpus row through
// this library and compares it with what GitLab's Ruby code returned.
import { evaluateValue, EvaluationCrash, ExpressionError, RegexValue, present } from '../src/index.ts';

export interface OracleResult {
  val?: unknown;
  null?: boolean;
  t?: boolean | null;
  err?: string;
  msg?: string;
  crash?: string;
}

const ERR_NAMES: Record<string, string> = {
  LexerSyntaxError: 'SyntaxError',
  ParseError: 'ParseError',
  StatementError: 'StatementError',
  OperatorError: 'OperatorError',
};

/** Returns null when this library agrees with the oracle, otherwise a description of the difference. */
export function compareRow(
  expression: string,
  variables: Record<string, string>,
  inputs: Record<string, string | number | boolean | null> | undefined,
  oracle: OracleResult,
): string | null {
  let got: string;
  try {
    const v = evaluateValue(expression, variables, inputs ? { inputs } : {});
    const enc = v instanceof RegexValue ? { regex: v.source } : v;
    got = JSON.stringify({ val: enc, t: present(v) });
  } catch (e) {
    if (e instanceof ExpressionError) got = JSON.stringify({ err: ERR_NAMES[e.name] ?? e.name, msg: e.message });
    else if (e instanceof EvaluationCrash) got = JSON.stringify({ crash: 'NoMethodError' });
    else throw e;
  }
  let want: string;
  if (oracle.err !== undefined) want = JSON.stringify({ err: oracle.err, msg: oracle.msg });
  else if (oracle.crash !== undefined) want = JSON.stringify({ crash: oracle.crash });
  else want = JSON.stringify({ val: oracle.null === true ? null : oracle.val, t: oracle.t });
  return got === want ? null : `expr=${JSON.stringify(expression)} got=${got} want=${want}`;
}

/** Documented differences from the oracle that are not bugs in the expression layer. */
export function knownResidual(expression: string): string | undefined {
  if (expression.includes('\\C')) return '\\C matches a byte in RE2 and a code point here';
  return undefined;
}

