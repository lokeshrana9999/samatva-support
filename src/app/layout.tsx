import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin", "latin-ext"] });
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin", "latin-ext"],
  weight: ["600"],
});

export const metadata: Metadata = {
  title: "samatva support",
  description:
    "An independent demo: a support assistant that helps you work out what kind of mental health help might fit. Not affiliated with Amaha.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${inter.variable} ${sourceSerif.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <ThemeProvider attribute="data-theme" storageKey="samatva:theme" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
