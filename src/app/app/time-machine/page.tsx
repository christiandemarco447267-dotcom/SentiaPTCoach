import type { Metadata } from "next";
import { TimeMachineView } from "@/components/time-machine-view";

export const metadata: Metadata = {
  title: "Time Machine",
  description: "Replay real market history with play money and see if you can beat the S&P 500.",
};

export default function Page() {
  return <TimeMachineView />;
}
