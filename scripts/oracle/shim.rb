# Minimal stand-ins for the Rails/GitLab pieces the expression code touches.
# Own code: nothing here is copied from GitLab. The regexp engine is Google RE2,
# reached through re2_bridge.py, unless RE2_MODE=onigmo (then Ruby's Regexp
# stands in and only patterns both engines read the same way are comparable).
require 'strscan'
require 'json'

class Object
  def present?; !blank?; end
  def blank?; respond_to?(:empty?) ? !!empty? : !self; end
end
class String
  def blank?; empty? || !!(self =~ /\A[[:space:]]*\z/); end
  def demodulize; split('::').last; end
  def underscore; gsub(/([a-z])([A-Z])/, '\1_\2').downcase; end
end
class NilClass; def blank?; true; end; end
class FalseClass; def blank?; true; end; end
class TrueClass; def blank?; false; end; end
class Numeric; def blank?; false; end; end

module ActiveSupport; class HashWithIndifferentAccess < Hash; end; end
class Hash
  def with_indifferent_access
    h = ActiveSupport::HashWithIndifferentAccess.new
    each { |k, v| h[k.to_s] = v }
    h
  end
end
def require_dependency(*); end

module Gitlab
  module Utils
    module StrongMemoize
      def self.included(base); base.extend(ClassMethods); end
      module ClassMethods
        def strong_memoize_attr(name)
          orig = instance_method(name)
          define_method(name) do
            @__memo ||= {}
            @__memo.key?(name) ? @__memo[name] : (@__memo[name] = orig.bind(self).call)
          end
        end
      end
      def strong_memoize(key); @__strong ||= {}; @__strong.key?(key) ? @__strong[key] : (@__strong[key] = yield); end
    end
  end

  class SafeRequestStore; def self.fetch(_key); yield; end; end

  module Re2Bridge
    PY = ENV['RE2_PYTHON'] || 'python3'
    BRIDGE = File.join(__dir__, 're2_bridge.py')
    def self.call(pattern, texts = [])
      @io ||= IO.popen([PY, BRIDGE, { err: File::NULL }], 'r+')
      @io.puts(JSON.generate('p' => pattern, 't' => texts))
      JSON.parse(@io.gets)
    end
    def self.available?
      @available ||= begin
        call('a')['ok'] ? :yes : :no
      rescue StandardError
        :no
      end
      @available == :yes
    end
  end

  class UntrustedRegexp
    attr_reader :source

    def initialize(pattern, multiline: false)
      pattern = "(?m)#{pattern}" if multiline
      @source = pattern
      if ENV['RE2_MODE'] == 'onigmo'
        init_onigmo(pattern)
      else
        r = Re2Bridge.call(pattern)
        raise RegexpError, r['err'] unless r['ok']
        @broken = r['broken']
      end
    end

    def scan(text)
      return [] if @broken
      if @onigmo
        out = []
        text.scan(@onigmo) { out << $~[0] }
        return out
      end
      Re2Bridge.call(@source, [text])['m'][0] ? [text] : []
    end

    def ==(other); source == other.source; end

    private

    # RE2 anchors are text anchors unless (?m); Ruby's are line anchors.
    def init_onigmo(pattern)
      flags = ''
      if (m = pattern.match(/\A\(\?([ismU]*)\)/))
        flags = m[1]
        pattern = m.post_match
      end
      unless flags.include?('m')
        pattern = pattern.gsub(/(\\.)|(\[(?:\\.|[^\]])*\])|\^|\$/) { $1 || $2 || ($& == '^' ? '\A' : '\z') }
      end
      opts = 0
      opts |= Regexp::IGNORECASE if flags.include?('i')
      opts |= Regexp::MULTILINE if flags.include?('s')
      @onigmo = Regexp.new(pattern, opts)
    rescue RegexpError => e
      raise RegexpError, e.message
    end
  end

  module Ci; module Pipeline; module Expression
    ExpressionError = Class.new(StandardError)
    module Lexeme; end
  end; end; end
end
