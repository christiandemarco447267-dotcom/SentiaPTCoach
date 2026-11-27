// Help chat + /support FAQ. The questions and answers live in one JSON file shared with the
// Cloudflare Worker (worker/src/support-faq.json), so the on-device matcher, the FAQ page and
// the AI fallback's grounding facts never drift apart.
//
// The matcher runs fully on the device (works offline): normalise → tokens → score each FAQ by
// keyword phrases, shared words and near-miss spellings. Framework-free and unit-tested.

import data from "../../worker/src/support-faq.json";

export type Faq = { id: string; q: string; a: string; keywords: string[] };

export const FAQS: Faq[] = data.faqs;
export const FAQ_UPDATED: string = data.updated;

const STOP = new Set(
  "a an and are as at be but by can could do does did for from get got have how i if in into is it its me my no not of on or our so that the their them then there this to too up us was we what when where which who why will with you your im ive dont cant please hi hello hey".split(" "),
);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Crude English stemming, enough to match "resetting"/"resets"/"reset". */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3).replace(/(.)\1$/, "$1");
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((w) => w && !STOP.has(w))
    .map(stem);
}

/** Levenshtein distance capped at 2 (enough for typo tolerance). */
function within1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

type Indexed = { faq: Faq; phrases: string[]; words: Set<string> };

const INDEX: Indexed[] = FAQS.map((faq) => ({
  faq,
  phrases: faq.keywords.map(normalize).filter((p) => p.includes(" ")),
  // Single-word keywords and the question's own words; multi-word keywords count only as whole phrases.
  words: new Set([...faq.keywords.filter((k) => !normalize(k).includes(" ")).flatMap(tokens), ...tokens(faq.q)]),
}));

export type FaqMatch = { faq: Faq; score: number };

/** Score every FAQ for this question, best first. */
export function rankFaqs(question: string): FaqMatch[] {
  const norm = ` ${normalize(question)} `;
  const qTokens = [...new Set(tokens(question))];
  if (!qTokens.length) return [];
  return INDEX.map(({ faq, phrases, words }) => {
    let score = 0;
    for (const p of phrases) if (norm.includes(` ${p} `)) score += 2 + p.split(" ").length * 0.5;
    for (const t of qTokens) {
      if (words.has(t)) score += t.length >= 4 ? 1.5 : 1;
      else if (t.length >= 5 && [...words].some((w) => w.length >= 5 && within1(t, w))) score += 1;
    }
    // Longer questions need more evidence: normalise a little by length.
    return { faq, score: score / Math.max(1, Math.sqrt(qTokens.length / 3)) };
  })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);
}

export const MATCH_THRESHOLD = 1.5;

/** The FAQ that answers this question, or null when nothing matches well enough (→ ask the AI / email support). */
export function bestFaq(question: string): FaqMatch | null {
  const [top] = rankFaqs(question);
  return top && top.score >= MATCH_THRESHOLD ? top : null;
}

/** Up to `n` other likely topics, shown as quick follow-up chips. */
export function relatedFaqs(question: string, exclude: string | null, n = 3): Faq[] {
  return rankFaqs(question)
    .filter((m) => m.faq.id !== exclude)
    .slice(0, n)
    .map((m) => m.faq);
}

/** Starter chips shown when the chat opens. */
export const STARTER_FAQ_IDS = ["verify-email", "forgot-password", "real-money", "autosave-devices"] as const;

export function faqById(id: string): Faq | undefined {
  return FAQS.find((f) => f.id === id);
}

/** Questions that should never be answered by the Help chat itself (investing advice) get a fixed redirect. */
export function looksLikeInvestingAdvice(question: string): boolean {
  const n = ` ${normalize(question)} `;
  return /\b(should i (buy|sell|hold|invest)|what (stock|stocks|shares) should|is .* a good (buy|investment|stock)|price target|will .* (go up|go down|rise|fall)|best stock)\b/.test(n);
}

/** A code or a password typed into the Help chat is never sent anywhere. */
export function looksLikeSecret(text: string): boolean {
  return /\b\d{6}\b/.test(text) || /\bpassword\s*(is|=|:)/i.test(text);
}
