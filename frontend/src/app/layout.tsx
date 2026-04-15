import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import Providers from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Legal Case Manager",
  description:
    "AI-integrated legal case management and document organization platform.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Script id="legalcm-theme-init" strategy="beforeInteractive">
          {`try {
            const saved = localStorage.getItem('legalcm:theme');
            const dark = saved === 'dark';
            document.documentElement.classList.toggle('dark', dark);
          } catch (e) {}
          `}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
