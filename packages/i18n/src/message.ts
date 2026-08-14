/**
 * Formatting a message, on the platform's own `Intl`.
 *
 * This implements the part of ICU MessageFormat the product actually uses:
 * argument interpolation and cardinal plurals. Not the whole grammar — no
 * `select`, no `selectordinal`, no nested date/number skeletons — because
 * nothing here needs them, and a full parser would be several hundred lines
 * defending syntax no catalog in this repo contains.
 *
 * Plural *categories* are not implemented at all; they come from
 * `Intl.PluralRules`, which is why this works for languages nobody here
 * speaks. English has two forms and Arabic has six, and hand-rolling that rule
 * — or worse, appending an "s" — is the classic way an app that "supports"
 * a language is visibly written by someone who does not.
 *
 * Syntax:
 *
 *     Hello {name}
 *     {count, plural, one {# episode} other {# episodes}}
 *     {count, plural, =0 {nothing yet} one {# show} other {# shows}}
 *
 * `#` is the count, formatted for the locale. An exact `=0` match wins over
 * the category, because "no episodes" is usually a different sentence rather
 * than a plural of one.
 */

export type MessageValues = Record<string, string | number>;

/** Cached per locale — constructing one per render is measurably wasteful. */
const pluralRules = new Map<string, Intl.PluralRules>();
const numberFormats = new Map<string, Intl.NumberFormat>();

function pluralRulesFor(locale: string): Intl.PluralRules {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules;
}

function numberFormatFor(locale: string): Intl.NumberFormat {
  let format = numberFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale);
    numberFormats.set(locale, format);
  }
  return format;
}

/**
 * Find the `}` matching the `{` at `open`.
 *
 * Needed because a plural's option bodies contain braces of their own, so
 * scanning for the next `}` would end an option in the middle of itself.
 */
function matchBrace(source: string, open: number): number {
  let depth = 0;

  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/**
 * Read `one {…} other {…}` into a map of category to body.
 *
 * Unknown categories are kept rather than rejected: a translator writing
 * `few` and `many` for Arabic is doing exactly the right thing, and this code
 * has no business having an opinion about which categories a language has.
 */
function parseOptions(source: string): Map<string, string> {
  const options = new Map<string, string>();
  let index = 0;

  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index]!)) index += 1;
    if (index >= source.length) break;

    const brace = source.indexOf('{', index);
    if (brace === -1) break;

    const key = source.slice(index, brace).trim();
    const close = matchBrace(source, brace);
    if (close === -1) break;

    if (key) options.set(key, source.slice(brace + 1, close));
    index = close + 1;
  }

  return options;
}

/**
 * Render a message.
 *
 * A missing value leaves the placeholder untouched rather than printing
 * `undefined`. A visible `{name}` in the UI is a bug report; the word
 * "undefined" in the middle of a sentence is a mystery.
 */
export function formatMessage(
  template: string,
  values: MessageValues = {},
  locale = 'en',
): string {
  let out = '';
  let index = 0;

  while (index < template.length) {
    const open = template.indexOf('{', index);

    if (open === -1) {
      out += template.slice(index);
      break;
    }

    out += template.slice(index, open);

    const close = matchBrace(template, open);
    if (close === -1) {
      // Unbalanced. Emit the rest literally rather than throwing — a broken
      // string should degrade to visible nonsense, not to a blank screen.
      out += template.slice(open);
      break;
    }

    const body = template.slice(open + 1, close);
    const comma = body.indexOf(',');

    if (comma === -1) {
      const name = body.trim();
      const value = values[name];
      out += value === undefined ? `{${name}}` : String(value);
      index = close + 1;
      continue;
    }

    const name = body.slice(0, comma).trim();
    const rest = body.slice(comma + 1);
    const typeEnd = rest.indexOf(',');
    const type = (typeEnd === -1 ? rest : rest.slice(0, typeEnd)).trim();

    if (type !== 'plural' || typeEnd === -1) {
      // A type this subset does not implement. The argument still renders, so
      // the sentence stays readable.
      const value = values[name];
      out += value === undefined ? `{${name}}` : String(value);
      index = close + 1;
      continue;
    }

    const count = Number(values[name] ?? 0);
    const options = parseOptions(rest.slice(typeEnd + 1));

    // An exact match first: "no episodes" is a different sentence, not a
    // plural form of "one episode".
    const category = pluralRulesFor(locale).select(count);
    const chosen = options.get(`=${count}`) ?? options.get(category) ?? options.get('other') ?? '';

    out += formatMessage(chosen.replaceAll('#', numberFormatFor(locale).format(count)), values, locale);

    index = close + 1;
  }

  return out;
}
