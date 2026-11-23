import type { Metadata } from "next";
import { Suspense } from "react";
import { LeaguesView } from "@/components/leagues-view";
import { Loading } from "@/components/ui";

export const metadata: Metadata = { title: "Friend leagues" };

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <LeaguesView />
    </Suspense>
  );
}
