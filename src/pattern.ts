// Port of Lexeme::Pattern, Pattern::RegularExpression and UntrustedRegexp::RubySyntax.
// Derived from GitLab, Copyright (c) 2011-present GitLab Inc. (MIT Expat); see LICENSE-gitlab.

import { LexerSyntaxError } from './errors.ts';
import { Re2, RegexpSyntaxError } from './re2/index.ts';

/** A compiled regular expression value (GitLab's `UntrustedRegexp`). */
export class RegexValue {
  /** The RE2 source, including a leading `(?flags)` when flags were given. */
  readonly source: string;
  /** @internal */
  readonly re: Re2;

  constructor(source: string) {
    this.source = source;
    this.re = new Re2(source);
  }
}

/**
 * `RubySyntax::PATTERN = %r{^/(?<regexp>.*)/(?<flags>[ismU]*)$}` applied with
 * `String#match`: Ruby's ^ and $ are line anchors, so the first line that looks
 * like /body/flags wins and the rest of the string is ignored.
 */
function matchRubySyntax(value: string): { regexp: string; flags: string } | undefined {
  let start = 0;
  for (;;) {
    let eol = value.indexOf('\n', start);
    if (eol < 0) eol = value.length;
    const line = value.slice(start, eol);
    if (line.startsWith('/')) {
      const last = line.lastIndexOf('/');
      if (last >= 1 && /^[ismU]*$/.test(line.slice(last + 1))) {
        return { regexp: line.slice(1, last), flags: line.slice(last + 1) };
      }
    }
    if (eol >= value.length) return undefined;
    start = eol + 1;
  }
}

/** `Pattern.new(string)`: unescape `\/`, then require a valid /re/flags. Throws LexerSyntaxError. */
export function buildPattern(text: string): { value: string; regex: RegexValue } {
  const value = text.replace(/\\\//g, '/');
  const m = matchRubySyntax(value);
  if (m === undefined) throw new LexerSyntaxError('Invalid regular expression!');
  try {
    return { value, regex: new RegexValue(m.flags.length > 0 ? `(?${m.flags})${m.regexp}` : m.regexp) };
  } catch (e) {
    if (e instanceof RegexpSyntaxError) throw new LexerSyntaxError('Invalid regular expression!');
    throw e;
  }
}
