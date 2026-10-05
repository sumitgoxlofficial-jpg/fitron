import type { Metadata } from "next";
import { Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { THEME_SCRIPT } from "@/lib/theme-script";

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  // The prototype stack: Source Serif 4, then the system UI font.
  fallback: ["system-ui", "sans-serif"],
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "Fitron",
  description: "Gym management and accounting",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`${sourceSerif.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
