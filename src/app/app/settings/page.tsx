import type { Metadata } from "next";
import { SettingsView } from "@/components/settings-view";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage your profile, theme, notifications, backups and data for Sentia.",
};

export default function SettingsPage() {
  return <SettingsView />;
}
