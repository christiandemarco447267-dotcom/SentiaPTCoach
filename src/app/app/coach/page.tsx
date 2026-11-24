import type { Metadata } from "next";
import { CoachView } from "@/components/coach-view";

export const metadata: Metadata = {
  title: "Ask Sentia",
  description: "Ask Sentia about your paper portfolio: concentration, cash, theses, biases and your Discipline Score.",
};

export default function Page() {
  return <CoachView />;
}
