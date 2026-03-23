"use client";

import dynamic from "next/dynamic";

const DynamicProviders = dynamic(() => import("~~/components/Providers").then(m => m.Providers), { ssr: false });

export function ProvidersWrapper({ children }: { children: React.ReactNode }) {
  return <DynamicProviders>{children}</DynamicProviders>;
}
