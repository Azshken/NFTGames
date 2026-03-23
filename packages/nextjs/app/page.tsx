import dynamic from "next/dynamic";

const PageContent = dynamic(
  () => import("~~/components/PageContent"),
  { ssr: false }
);

export default function Page() {
  return <PageContent />;
}
