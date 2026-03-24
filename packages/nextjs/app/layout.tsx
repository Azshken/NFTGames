import "@rainbow-me/rainbowkit/styles.css";
import "~~/styles/globals.css";
import { Providers } from "~~/components/ProvidersClient";
import { Header } from "~~/components/HeaderClient";
import { Footer } from "~~/components/Footer";
import { Toaster } from "sonner";
import { cookies } from "next/headers";
import { cookieToInitialState } from "wagmi";
import { config } from "~~/components/ProvidersClient";

export const metadata = {
  title: "Soulkey Store",
  description: "Mint verifiable game keys as virtual game cards",
};

export default async function RootLayout({ children }: { children: React.ReactNode
}) {
  const initialState = cookieToInitialState(config, (await cookies()).toString());

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
