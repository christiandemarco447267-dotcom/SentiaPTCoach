import type { Metadata } from "next";
import { DashboardHome } from "@/components/dashboard-home";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your paper-trading dashboard: portfolio value, Discipline Score and your next step.",
};

export default function AppHomePage() {
  return <DashboardHome />;
}
