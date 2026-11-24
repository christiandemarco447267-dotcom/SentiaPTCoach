import type { Metadata } from "next";
import { PortfolioView } from "@/components/portfolio-view";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "Your paper portfolio holdings, performance against the S&P 500 and win rate.",
};

export default function PortfolioPage() {
  return <PortfolioView />;
}
