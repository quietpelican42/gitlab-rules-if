import { parseRe2, RegexpSyntaxError } from './parse.ts';
import { Program } from './program.ts';

export { RegexpSyntaxError } from './parse.ts';

/**
 * A compiled RE2 pattern. Mirrors what GitLab's UntrustedRegexp needs: construction
 * fails where RE2 fails, and `matches` reports whether `scan` would find anything.
 */
export class Re2 {
  readonly source: string;
  readonly captures: number;
  private program: Program;
  private scanBroken: boolean;

  constructor(source: string) {
    this.source = source;
    const parsed = parseRe2(source);
    this.captures = parsed.captures;
    this.program = new Program().build(parsed.node);
    // UntrustedRegexp#scan wraps a group-less pattern in "(...)". If that wrapped
    // form does not compile (an unterminated \Q), the scan finds nothing.
    this.scanBroken = false;
    if (parsed.captures === 0) {
      try {
        parseRe2(`(${source})`);
      } catch (e) {
        if (!(e instanceof RegexpSyntaxError)) throw e;
        this.scanBroken = true;
      }
    }
  }

  /** True when the pattern matches anywhere in `text` (zero-width matches count). */
  matches(text: string): boolean {
    return this.program.test(Array.from(text, (ch) => ch.codePointAt(0) as number));
  }

  /** True when GitLab's `scan(text)` would return at least one match. */
  scanFinds(text: string): boolean {
    return !this.scanBroken && this.matches(text);
  }
}
