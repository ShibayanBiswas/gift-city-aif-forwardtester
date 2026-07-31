"use client";

import { ForwardTestProvider } from "@/lib/store";
import { AppShell } from "@/components/layout/AppShell";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ForwardTestProvider>
      <AppShell>{children}</AppShell>
    </ForwardTestProvider>
  );
}
