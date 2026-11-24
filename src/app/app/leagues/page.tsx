import type { Metadata } from "next";
import { Suspense } from "react";
import { LeaguesView } from "@/components/leagues-view";
import { Loading } from "@/components/ui";

export const metadata: Metadata = {
  title: "Friend leagues",
  description: "Compete with friends on discipline and returns using play money.",
  robots: { index: false },
};

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <LeaguesView />
    </Suspense>
  );
}
