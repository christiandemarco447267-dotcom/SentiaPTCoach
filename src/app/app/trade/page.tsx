import type { Metadata } from "next";
import { Suspense } from "react";
import { TradeView } from "@/components/trade-view";
import { Loading } from "@/components/ui";

export const metadata: Metadata = {
  title: "Trade",
  description: "Practice buying and selling stocks with play money, with a pre-trade checklist.",
};

export default function TradePage() {
  return (
    <Suspense fallback={<Loading />}>
      <TradeView />
    </Suspense>
  );
}
