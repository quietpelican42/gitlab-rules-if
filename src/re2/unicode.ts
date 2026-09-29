// Unicode helpers for the RE2 subset: simple case-fold orbits and the
// \p{...} property names RE2 accepts, answered through the JS RegExp engine.

const SCRIPTS = new Set(
  (
    'Adlam Ahom Anatolian_Hieroglyphs Arabic Armenian Avestan Balinese Bamum Bassa_Vah Batak Bengali ' +
    'Bhaiksuki Bopomofo Brahmi Braille Buginese Buhid Canadian_Aboriginal Carian Caucasian_Albanian ' +
    'Chakma Cham Cherokee Chorasmian Common Coptic Cuneiform Cypriot Cypro_Minoan Cyrillic Deseret ' +
    'Devanagari Dives_Akuru Dogra Duployan Egyptian_Hieroglyphs Elbasan Elymaic Ethiopic Georgian ' +
    'Glagolitic Gothic Grantha Greek Gujarati Gunjala_Gondi Gurmukhi Han Hangul Hanifi_Rohingya ' +
    'Hanunoo Hatran Hebrew Hiragana Imperial_Aramaic Inherited Inscriptional_Pahlavi ' +
    'Inscriptional_Parthian Javanese Kaithi Kannada Katakana Kawi Kayah_Li Kharoshthi ' +
    'Khitan_Small_Script Khmer Khojki Khudawadi Lao Latin Lepcha Limbu Linear_A Linear_B Lisu Lycian ' +
    'Lydian Mahajani Makasar Malayalam Mandaic Manichaean Marchen Masaram_Gondi Medefaidrin ' +
    'Meetei_Mayek Mende_Kikakui Meroitic_Cursive Meroitic_Hieroglyphs Miao Modi Mongolian Mro Multani ' +
    'Myanmar Nabataean Nag_Mundari Nandinagari New_Tai_Lue Newa Nko Nushu Nyiakeng_Puachue_Hmong ' +
    'Ogham Ol_Chiki Old_Hungarian Old_Italic Old_North_Arabian Old_Permic Old_Persian Old_Sogdian ' +
    'Old_South_Arabian Old_Turkic Old_Uyghur Oriya Osage Osmanya Pahawh_Hmong Palmyrene Pau_Cin_Hau ' +
    'Phags_Pa Phoenician Psalter_Pahlavi Rejang Runic Samaritan Saurashtra Sharada Shavian Siddham ' +
    'SignWriting Sinhala Sogdian Sora_Sompeng Soyombo Sundanese Syloti_Nagri Syriac Tagalog Tagbanwa ' +
    'Tai_Le Tai_Tham Tai_Viet Takri Tamil Tangsa Tangut Telugu Thaana Thai Tibetan Tifinagh Tirhuta ' +
    'Toto Ugaritic Vai Vithkuqi Wancho Warang_Citi Yezidi Yi Zanabazar_Square'
  ).split(' '),
);

const CATEGORIES = new Set(
  'Cc Cf Co Cs L Ll Lm Lo Lt Lu M Mc Me Mn N Nd Nl No P Pc Pd Pe Pf Pi Po Ps S Sc Sk Sm So Z Zl Zp Zs'.split(' '),
);

const propCache = new Map<string, RegExp | null>();

/** A predicate for `\p{name}`, or undefined when RE2 does not know the name. */
export function lookupProperty(name: string): ((cp: number) => boolean) | undefined {
  if (name === 'Any') return () => true;
  let source: string;
  if (name === 'C') source = '[\\p{Cc}\\p{Cf}\\p{Co}\\p{Cs}]';
  else if (CATEGORIES.has(name)) source = `\\p{${name}}`;
  else if (SCRIPTS.has(name)) source = `\\p{Script=${name}}`;
  else return undefined;
  let re = propCache.get(name);
  if (re === undefined) {
    try {
      re = new RegExp(`^${source}$`, 'u');
    } catch {
      re = null;
    }
    propCache.set(name, re);
  }
  if (re === null) return () => false;
  const r = re;
  return (cp) => r.test(String.fromCodePoint(cp));
}

// ---- simple case folding orbits ----

let groups: Map<number, number[]> | undefined;

function single(s: string): number {
  const cp = s.codePointAt(0);
  if (cp === undefined) return -1;
  return s.length === (cp > 0xffff ? 2 : 1) ? cp : -1;
}

function foldKey(cp: number): number {
  const s = String.fromCodePoint(cp);
  const up = single(s.toUpperCase());
  const base = up >= 0 ? up : cp;
  const lo = single(String.fromCodePoint(base).toLowerCase());
  return lo >= 0 ? lo : base;
}

function buildGroups(): Map<number, number[]> {
  const byKey = new Map<number, number[]>();
  for (let cp = 0; cp < 0x1f000; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const k = foldKey(cp);
    let g = byKey.get(k);
    if (g === undefined) {
      g = [];
      byKey.set(k, g);
    }
    g.push(cp);
  }
  for (const [k, g] of byKey) if (g.length < 2) byKey.delete(k);
  return byKey;
}

const orbitCache = new Map<number, number[]>();

function sameFold(a: number, b: number): boolean {
  if (a === b) return true;
  return new RegExp(`^\\u{${a.toString(16)}}$`, 'iu').test(String.fromCodePoint(b));
}

/** All code points equivalent to `cp` under Unicode simple case folding (including `cp`). */
export function foldOrbit(cp: number): number[] {
  const hit = orbitCache.get(cp);
  if (hit !== undefined) return hit;
  groups ??= buildGroups();
  const g = groups.get(foldKey(cp));
  let out: number[];
  if (g === undefined || cp >= 0x1f000) out = [cp];
  else out = g.filter((x) => sameFold(cp, x));
  if (!out.includes(cp)) out.push(cp);
  orbitCache.set(cp, out);
  return out;
}
