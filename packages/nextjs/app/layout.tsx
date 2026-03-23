import "@rainbow-me/rainbowkit/styles.css";
import "~~/styles/globals.css";
import { Toaster } from "sonner";
import { Header } from "~~/components/Header";
import { Footer } from "~~/components/Footer";
import { ProvidersWrapper } from '~~/components/ProvidersWrapper';

export const metadata = {
  title: "Soulkey Store",
  description: "Mint verifiable game keys as virtual game cards",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ProvidersWrapper>
          <Header />
          <Toaster position="bottom-right" theme="dark" richColors />
          {children}
          <Footer />
        </ProvidersWrapper>
      </body>
    </html>
  );
}
