import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mixamo R6 Converter",
  description: "Preview and convert Mixamo animation poses to Roblox R6.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="brandMark">R6</span>
            <span>
              <strong>Mixamo Converter</strong>
              <small>Pose projection preview</small>
            </span>
          </Link>
          <div className="phaseBadge">Phase 1 · Preview Solver</div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
