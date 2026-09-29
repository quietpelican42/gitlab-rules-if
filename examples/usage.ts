import { evaluate, evaluateValue, parse, inspect } from '../src/index.ts';

const variables = { CI_COMMIT_BRANCH: 'main', CI_PIPELINE_SOURCE: 'push', EMPTY: '' };

console.log(evaluate('$CI_COMMIT_BRANCH == "main" && $CI_PIPELINE_SOURCE =~ /^(push|web)$/', variables));
console.log(JSON.stringify(evaluateValue('$EMPTY && "x"', variables)));
console.log(inspect(parse('$A || $B && !$C')));
