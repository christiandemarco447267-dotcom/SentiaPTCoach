import type { Metadata } from "next";
import { AllocateView } from "@/components/allocate-view";

export const metadata: Metadata = {
  title: "Allocation",
  description: "See how your paper portfolio is spread across sectors and funds, and plan a better balance.",
};

export default function AllocatePage() {
  return <AllocateView />;
}
