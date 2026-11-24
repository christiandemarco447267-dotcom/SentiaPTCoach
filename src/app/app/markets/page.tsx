import type { Metadata } from "next";
import { MarketsView } from "@/components/markets-view";

export const metadata: Metadata = {
  title: "Markets",
  description: "Browse stocks and funds with prices, daily moves and quick links to practice a trade.",
};

export default function MarketsPage() {
  return <MarketsView />;
}
