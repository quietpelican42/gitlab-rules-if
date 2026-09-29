# Loads GitLab's expression code from the pinned, hash-checked cache (.cache/gitlab).
require_relative 'shim'
ROOT = ENV['GITLAB_CACHE'] || File.expand_path('../../.cache/gitlab', __dir__)
expr = File.join(ROOT, 'lib/gitlab/ci/pipeline/expression')
%w[base value operator logical_operator unary_operator].each { |f| require File.join(expr, 'lexeme', f) }
%w[pattern pattern/regular_expression string variable null boolean input and or not equals not_equals
   matches not_matches parenthesis_open parenthesis_close].each { |f| require File.join(expr, 'lexeme', f) }
%w[token lexer parser statement].each { |f| require File.join(expr, f) }
require File.join(ROOT, 'lib/gitlab/untrusted_regexp/ruby_syntax')
