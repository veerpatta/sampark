import type { Metadata, Viewport } from "next";
import { Anek_Latin, Anek_Devanagari, IBM_Plex_Mono } from "next/font/google";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

/**
 * Anek is by Ek Type and is built for Indian multi-script setting — the Latin
 * and Devanagari cuts share metrics, so a Hindi label and an English label sit
 * on the same baseline without the usual mismatch.
 */
const anekLatin = Anek_Latin({
  variable: "--font-anek-latin",
  subsets: ["latin"],
  display: "swap",
});

const anekDevanagari = Anek_Devanagari({
  variable: "--font-anek-devanagari",
  subsets: ["devanagari", "latin"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sampark — VPPS Data Desk",
  description:
    "Shri Veer Patta Senior Secondary School — student data collection and reconciliation.",
  manifest: "/manifest.json",
  // Belt and braces alongside the X-Robots-Tag header in next.config.ts.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#1d4ed8",
  width: "device-width",
  initialScale: 1,
  // Teachers pinch-zoom to read. Do not take that away.
  maximumScale: 5,
  /**
   * Shrink the page when the on-screen keyboard opens instead of letting the
   * keyboard sit on top of it. Without this, `position: sticky` bottom bars are
   * pinned to a viewport the keyboard is covering, so "हो गया" and "देखें और
   * भेजें" end up underneath it at exactly the moment she wants them.
   */
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="hi">
      <body
        className={`${anekLatin.variable} ${anekDevanagari.variable} ${plexMono.variable} antialiased`}
      >
        {/* Both surfaces get it: the office needs undo, the teacher needs to
            be told her forty taps landed. */}
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
