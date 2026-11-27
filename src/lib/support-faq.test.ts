import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { bestFaq, FAQS, faqById, looksLikeInvestingAdvice, looksLikeSecret, normalize, rankFaqs, relatedFaqs, STARTER_FAQ_IDS } from "./support-faq";
import { copyrightLine, SUPPORT_EMAIL, supportMailto } from "./support";
import { FEEDBACK_EMAIL } from "./feedback";

test("the FAQ has 15–20 unique, complete entries covering the requested topics", () => {
  assert.ok(FAQS.length >= 15 && FAQS.length <= 20, `got ${FAQS.length}`);
  assert.equal(new Set(FAQS.map((f) => f.id)).size, FAQS.length);
  for (const f of FAQS) {
    assert.ok(f.q.endsWith("?"), f.id);
    assert.ok(f.a.length > 40 && f.a.length < 600, f.id);
    assert.ok(f.keywords.length >= 3, f.id);
  }
  for (const id of ["what-is-sentia", "real-money", "account-needed", "verify-email", "forgot-password", "face-id", "google-apple", "autosave-devices", "delete-account", "privacy", "prices", "coach", "leagues", "apps", "contact"]) {
    assert.ok(faqById(id), `missing ${id}`);
  }
  for (const id of STARTER_FAQ_IDS) assert.ok(faqById(id));
  assert.ok(faqById("contact")?.a.includes(SUPPORT_EMAIL));
});

test("matches common questions (with typos and paraphrases) to the right answer", () => {
  const cases: [string, string][] = [
    ["I didn't get the verification email", "verify-email"],
    ["my code expired", "verify-email"],
    ["how do i reset my pasword", "forgot-password"],
    ["Is this real money?", "real-money"],
    ["can I use face id", "face-id"],
    ["sign in with google", "google-apple"],
    ["delete my account", "delete-account"],
    ["are prices real time", "prices"],
    ["does it sync between my phone and laptop", "autosave-devices"],
    ["how do I contact a human", "contact"],
    ["leagues with friends", "leagues"],
    ["is there an iphone app", "apps"],
    ["how old do I have to be", "age"],
    ["what data do you collect", "privacy"],
    ["what is Sentia", "what-is-sentia"],
    ["should I buy Tesla", "advice"],
  ];
  for (const [q, id] of cases) assert.equal(bestFaq(q)?.faq.id, id, q);
});

test("doesn't pretend to know unrelated things", () => {
  for (const q of ["what's the weather in paris", "tell me a joke", "", "??"]) assert.equal(bestFaq(q), null, q);
  assert.deepEqual(rankFaqs("   "), []);
  assert.equal(relatedFaqs("reset password", "forgot-password").some((f) => f.id === "forgot-password"), false);
});

test("guards: investing-advice questions and secrets are caught before anything is sent", () => {
  assert.equal(looksLikeInvestingAdvice("Should I buy NVDA now?"), true);
  assert.equal(looksLikeInvestingAdvice("will apple go up tomorrow"), true);
  assert.equal(looksLikeInvestingAdvice("how do I reset my password"), false);
  assert.equal(looksLikeSecret("my code is 123456"), true);
  assert.equal(looksLikeSecret("my password is hunter22"), true);
  assert.equal(looksLikeSecret("how do I change my password"), false);
  assert.equal(normalize("Héllo, Wörld!"), "hello world");
});

test("support address is used everywhere and mailto links are prefilled", () => {
  assert.equal(SUPPORT_EMAIL, "support@sentiacoach.com");
  assert.equal(FEEDBACK_EMAIL, process.env.NEXT_PUBLIC_FEEDBACK_EMAIL?.trim() || SUPPORT_EMAIL);
  assert.equal(supportMailto("Sentia help: reset"), "mailto:support@sentiacoach.com?subject=Sentia%20help%3A%20reset");
  assert.match(supportMailto("Hi", "line 1\nline 2"), /&body=line%201%0Aline%202$/);
  assert.equal(copyrightLine(2031), "© 2031 Sentia · Christian DeMarco. All rights reserved.");
  assert.match(copyrightLine(), new RegExp(`© ${new Date().getFullYear()} `));
  // The worker's emails reply to the same inbox, and its FAQ file is the one this module reads.
  const mailer = readFileSync(join(process.cwd(), "worker", "src", "mailer.ts"), "utf8");
  assert.match(mailer, /SUPPORT_EMAIL = "support@sentiacoach\.com"/);
  for (const page of ["support", "privacy", "terms"]) {
    const src = readFileSync(join(process.cwd(), "src", "app", page, "page.tsx"), "utf8");
    assert.match(src, /SUPPORT_EMAIL|supportMailto/, page);
  }
});

test("legal pages are titled and dated as requested, and every auth screen carries the legal footer", () => {
  const terms = readFileSync(join(process.cwd(), "src", "app", "terms", "page.tsx"), "utf8");
  const privacy = readFileSync(join(process.cwd(), "src", "app", "privacy", "page.tsx"), "utf8");
  assert.match(terms, /title="Terms and Conditions" updated="November 26, 2026"/);
  assert.match(privacy, /title="Privacy Policy" updated="November 26, 2026"/);
  for (const needle of ["PBKDF2", "Resend", "Workers KV", "OpenAI", "Finnhub", "sessionStorage", "under 13", "sell"]) assert.ok(privacy.includes(needle), needle);
  for (const needle of ["Maryland", "Not investment advice", "Not a brokerage", "Acceptable use", "Intellectual property", "Suspension and termination"]) assert.ok(terms.includes(needle), needle);
  const card = readFileSync(join(process.cwd(), "src", "components", "auth", "auth-card.tsx"), "utf8");
  assert.match(card, /<AuthLegalFooter \/>/);
  const signup = readFileSync(join(process.cwd(), "src", "components", "auth", "sentia-auth-forms.tsx"), "utf8");
  assert.match(signup, /href="\/terms"[^>]*>\s*Terms and Conditions/);
  assert.match(signup, /href="\/privacy"[^>]*>\s*Privacy Policy/);
});
