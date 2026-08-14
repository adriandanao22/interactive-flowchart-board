import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Interactive Flowchart Board",
  description:
    "Paste a picture of a flowchart and get a live board you can drag, edit, and step through.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Deliberately not capping the scale: pinching the page is how someone with
  // low vision reads a diagram, and the canvas has its own zoom anyway.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0e13" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/*
        The board owns the viewport, so the page itself never scrolls. `dvh`
        rather than `%` because mobile browser chrome shrinks and grows as you
        scroll, and a percentage height leaves the bottom of the board clipped
        under it.
      */}
      <body className="flex h-dvh flex-col overflow-hidden overscroll-none">{children}</body>
    </html>
  );
}
