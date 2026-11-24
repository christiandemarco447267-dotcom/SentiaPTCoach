import type { Metadata } from "next";
import { WatchlistView } from "@/components/watchlist-view";

export const metadata: Metadata = {
  title: "Watchlist",
  description: "Track tickers you're interested in and set price alerts.",
};

export default function WatchlistPage() {
  return <WatchlistView />;
}
