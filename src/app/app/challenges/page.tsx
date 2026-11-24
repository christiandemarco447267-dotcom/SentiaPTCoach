import type { Metadata } from "next";
import { ChallengesView } from "@/components/challenges-view";

export const metadata: Metadata = {
  title: "Challenges",
  description: "Earn badges for good investing habits: written plans, diversification and patience.",
};

export default function Page() {
  return <ChallengesView />;
}
