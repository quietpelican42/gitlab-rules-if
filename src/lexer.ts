// Port of lib/gitlab/ci/pipeline/expression/lexer.rb and the lexeme patterns.
// Derived from GitLab, Copyright (c) 2011-present GitLab Inc. (MIT Expat); see LICENSE-gitlab.

import { LexerSyntaxError } from './errors.ts';

export type LexemeName =
  | 'parenthesisopen'
  | 'parenthesisclose'
  | 'input'
  | 'variable'
  | 'string'
  | 'pattern'
  | 'null'
  | 'boolean'
  | 'equals'
  | 'matches'
  | 'notequals'
  | 'notmatches'
  | 'and'
  | 'or'
  | 'not';

export interface Token {
  /** GitLab's `Token#to_lexeme`: the lowercased lexeme class name. */
  lexeme: LexemeName;
  /** The matched source text. */
  value: string;
}

// Ruby's \s is ASCII only. Onigmo's \b treats Letter, Mark, Number and
// Connector_Punctuation as word characters.
const WORD = '[\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}]';

// Order matters: it is Lexer::LEXEMES.
const LEXEMES: readonly [LexemeName, RegExp][] = [
  ['parenthesisopen', /^\(/],
  ['parenthesisclose', /^\)/],
  ['input', /^\$\[\[[ \t\r\n\f\v]*inputs\.[\w-]+[ \t\r\n\f\v]*\]\]/],
  ['variable', /^\$\w+/],
  ['string', /^(?:"[^\n]*?"|'[^\n]*?')/],
  ['pattern', /^\/(?:[^/]|\\\/)+[^\\]\/[ismU]*/],
  ['null', /^null/],
  ['boolean', new RegExp(`^(?:true|false)(?!${WORD})`, 'u')],
  ['equals', /^==/],
  ['matches', /^=~/],
  ['notequals', /^!=/],
  ['notmatches', /^!~/],
  ['and', /^&&/],
  ['or', /^\|\|/],
  ['not', /^!/],
];

export const MAX_TOKENS = 100;

const isSpace = (c: string): boolean => c === ' ' || (c >= '\t' && c <= '\r');

/**
 * Splits an expression into tokens. Like GitLab's lexer it gives up after
 * 100 iterations: an expression of exactly 100 tokens is already "too many".
 */
export function tokenize(statement: string, maxTokens: number = MAX_TOKENS): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  for (let i = 0; i < maxTokens; i++) {
    while (pos < statement.length && isSpace(statement[pos] as string)) pos++;
    if (pos >= statement.length) return tokens;
    const rest = statement.slice(pos);
    let matched = false;
    for (const [lexeme, re] of LEXEMES) {
      const m = re.exec(rest);
      if (m !== null) {
        tokens.push({ lexeme, value: m[0] });
        pos += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) throw new LexerSyntaxError('Unknown lexeme found!');
  }
  throw new LexerSyntaxError('Too many tokens!');
}
