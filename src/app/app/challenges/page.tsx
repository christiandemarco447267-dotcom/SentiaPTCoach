import type { Metadata } from "next";
import { ChallengesView } from "@/components/challenges-view";

export const metadata: Metadata = { title: "Challenges" };

export default function Page() {
  return <ChallengesView />;
}
