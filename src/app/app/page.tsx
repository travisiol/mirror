import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { SetupLoader } from "@/components/app/loaders";

export const metadata: Metadata = { title: "Your subscriptions" };

export default function SetupPage() {
  return (
    <AppShell>
      <SetupLoader />
    </AppShell>
  );
}
