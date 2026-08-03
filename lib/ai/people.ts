/**
 * Working out which people a listener is asking about.
 *
 * This exists to keep a reference lookup narrow. The assistant is deliberately
 * confined to one episode, and the one place it has to reach outside is a
 * question about who someone is — the host, the guest — where it would
 * otherwise answer from memory and can get a real person's life wrong.
 *
 * So a lookup happens only when both things are true: the listener is asking
 * about a person, and that person is someone this episode is actually about.
 * A name the episode never mentions is not looked up, which is what stops a
 * grounding feature from quietly becoming a general search engine.
 */

/** Two or three capitalized words, no digits, no acronyms — shaped like a name. */
const NAME_LIKE = /\b[A-Z][a-z]+(?:['-][A-Z]?[a-z]+)?(?:\s+[A-Z][a-z]+(?:['-][A-Z]?[a-z]+)?){1,2}\b/g;

/** Questions that are asking who somebody is, rather than what was said. */
const ASKING_ABOUT_A_PERSON =
  /\bwho(?:'s|\s+is|\s+are|\s+was|\s+were)\b|\bbackground\b|\btell me about\b|\bmore about\b/i;

/**
 * The people this episode is about: whoever the feed credits, plus the names in
 * the episode's own title, which is where podcasts almost always put the guest.
 */
export function episodePeople(
  author: string | null | undefined,
  episodeTitle: string,
): string[] {
  const found = new Set<string>();

  // "Chelle and Sam", "Tom & Jerry", "A, B" — feeds credit more than one host.
  for (const part of (author ?? "").split(/,|\band\b|&/)) {
    const name = part.trim();
    if (name) found.add(name);
  }

  // Titles are pipe- or dash-separated grab bags; the names are what matter.
  for (const match of episodeTitle.matchAll(NAME_LIKE)) {
    found.add(match[0]);
  }

  return [...found];
}

/**
 * Which of those the listener is asking about — empty unless they are asking
 * about a person at all.
 *
 * Matching is case-insensitive and accepts a surname on its own, because people
 * type "who is ranjit bajaj" and "what about Bajaj" rather than the name as the
 * feed spells it.
 */
export function peopleAskedAbout(question: string, people: string[]): string[] {
  if (!ASKING_ABOUT_A_PERSON.test(question)) return [];

  const asked = question.toLowerCase();
  return people.filter((person) => {
    const full = person.toLowerCase();
    if (asked.includes(full)) return true;

    const surname = full.split(/\s+/).pop();
    // A one-word surname match is only meaningful if it is a real word of its
    // own in the question — "raj" should not match "maharaja".
    return Boolean(
      surname &&
        surname.length > 3 &&
        new RegExp(`\\b${surname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(asked),
    );
  });
}
