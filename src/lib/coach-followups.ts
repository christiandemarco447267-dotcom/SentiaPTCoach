// Follow-up chips under a coach answer. The AI coach answers one question at a
// time (no chat memory), so each follow-up carries a short quote of the answer
// it refers to. Pure; unit-tested.
import { stripMarkdown } from "./markdown";

export type FollowUp = { label: string; question: string };

const QUESTION_MAX = 300;

function quote(answer: string, room: number): string {
  const plain = stripMarkdown(answer).replace(/Educational only[^.]*\.?/i, "").trim();
  if (room <= 10) return "";
  return plain.length > room ? `${plain.slice(0, room - 1).trimEnd()}…` : plain;
}

function withQuote(prefix: string, answer: string): string {
  const head = `${prefix} About your answer: "`;
  const q = quote(answer, QUESTION_MAX - head.length - 2);
  return q ? `${head}${q}"` : prefix;
}

/** Up to four follow-ups: three generic ones plus one picked from the answer's topic. */
export function followUpChips(answer: string): FollowUp[] {
  const text = answer.toLowerCase();
  const out: FollowUp[] = [
    { label: "Show me how", question: withQuote("Show me how to do that in Sentia, step by step.", answer) },
    { label: "What should I do next?", question: withQuote("What's the one next step I should practice in Sentia?", answer) },
    { label: "Explain simpler", question: withQuote("Explain that more simply, like I'm new to investing.", answer) },
  ];
  const topical: [RegExp, FollowUp][] = [
    [/thesis|theses/, { label: "Help me write a thesis", question: "How do I write a good thesis for a holding in Sentia?" }],
    [/discipline score/, { label: "Raise my Discipline Score", question: "How can I raise my Discipline Score?" }],
    [/diversif|sector|concentrat/, { label: "How do I diversify?", question: "How could I diversify my paper portfolio better?" }],
    [/fomo|revenge|panic|bias/, { label: "Avoid that bias", question: "How do I avoid the biases Bias Radar flagged?" }],
    [/s&p|spy|benchmark|market/, { label: "How am I vs. the market?", question: "How am I doing versus the S&P 500?" }],
    [/stop|alert|risk/, { label: "Set a stop or alert", question: "How do I set a price alert or stop order in Sentia?" }],
  ];
  const hit = topical.find(([re]) => re.test(text));
  if (hit) out.push(hit[1]);
  return out.map((f) => ({ ...f, question: f.question.slice(0, QUESTION_MAX) }));
}
