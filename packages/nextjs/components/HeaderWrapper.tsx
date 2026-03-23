"use client";

import dynamic from "next/dynamic";

const DynamicHeader = dynamic(
  () => import("~~/components/Header").then(m => m.Header),
  { ssr: false }
);

export function HeaderWrapper() {
  return <DynamicHeader />;
}