import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { DashboardLoader } from "@/components/app/loaders";

export const metadata: Metadata = { title: "This month's mirror" };

export default function DashboardPage() {
  return (
    <AppShell>
      <DashboardLoader />
    </AppShell>
  );
}
