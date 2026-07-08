import type { Metadata } from "next";
import { Space_Mono } from "next/font/google";
import "./globals.css";

// UI chrome font (self-hosted via next/font) exposed as a CSS variable.
const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "palmós",
  description:
    "screenshot in → editable layers out → layers dance to sound",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/*
          Artwork TextLayers are rendered by canvas (Konva/Pixi), which
          needs literal font-family names — so the design-kit display
          fonts (SPEC2 §12.4) load by their real names via Google Fonts.
          Offline, text falls back to system fonts (graceful).
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;700&family=Silkscreen&display=swap"
        />
      </head>
      <body className={`${spaceMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
