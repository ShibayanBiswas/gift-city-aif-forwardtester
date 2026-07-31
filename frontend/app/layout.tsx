import type { Metadata } from "next";
import { Cormorant_Garamond, Source_Sans_3 } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const ui = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ui-face",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Gift City AIF Forwardtester | Anand Rathi Wealth",
  description: "SEBI Category III GIFT City AIF structured product GBM Monte Carlo forward tester",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${ui.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
