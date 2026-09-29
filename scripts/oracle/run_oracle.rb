# Usage: ruby scripts/oracle/run_oracle.rb corpus.json out.json
# corpus rows: {"e": expression, "v": {name => value}, "i": {name => value}?}
# result rows: {"val": ..., "t": truthful, "err": ErrorClass?}
require 'json'
require_relative 'load'

S = Gitlab::Ci::Pipeline::Expression::Statement

def encode(v)
  v.is_a?(Gitlab::UntrustedRegexp) ? { 'regex' => v.source } : v
end

rows = JSON.parse(File.read(ARGV[0]))
out = rows.map do |r|
  vars = r['v'] || {}
  vars = vars.merge(inputs: r['i']) if r['i']
  begin
    st = S.new(r['e'], vars)
    ev = st.evaluate
    { 'val' => encode(ev), 'null' => ev.nil?, 't' => ev.present? }
  rescue Gitlab::Ci::Pipeline::Expression::ExpressionError => e
    { 'err' => e.class.name.split('::').last, 'msg' => e.message, 't' => false }
  rescue StandardError, SystemStackError => e
    { 'crash' => e.class.name, 't' => nil }
  end
end
File.write(ARGV[1], JSON.generate(out))
