/** Base class for the errors GitLab's `Expression::ExpressionError` covers. */
export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** GitLab's `Lexer::SyntaxError`: unknown lexeme, too many tokens, invalid regular expression. */
export class LexerSyntaxError extends ExpressionError {}

/** GitLab's `Parser::ParseError`. */
export class ParseError extends ExpressionError {}

/** GitLab's `Statement::StatementError`: the expression has no tokens. */
export class StatementError extends ExpressionError {}

/** GitLab's `Lexeme::Operator::OperatorError`: an operator is missing an operand. */
export class OperatorError extends ExpressionError {}

/**
 * Where GitLab's Ruby code raises something that is not an `ExpressionError`
 * (a `NoMethodError` on `true =~ ...`, say). GitLab does not rescue these in
 * `truthful?`, and neither does `truthful()` here.
 */
export class EvaluationCrash extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvaluationCrash';
  }
}
