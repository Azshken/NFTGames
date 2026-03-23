import "@rainbow-me/rainbowkit/styles.css";
import "~~/styles/globals.css";
import { headers } from "next/headers";
import { cookieToInitialState } from "wagmi";
import { wagmiConfig } from "~~/lib/wagmi";
import { Providers } from "~~/components/Providers";
import { Header } from "~~/components/Header";
import { Footer } from "~~/components/Footer";
import { Toaster } from "sonner";

export const metadata = {
  title: "Soulkey Store",
  description: "Mint verifiable game keys as virtual game cards",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const initialState = cookieToInitialState(wagmiConfig, (await headers()).get("cookie"));
  return (
    <html lang="en">
      <body>
        <Providers initialState={initialState}>
          <Header />
          <Toaster position="bottom-right" theme="dark" richColors />
          {children}
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
