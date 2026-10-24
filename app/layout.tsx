import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Support triage",
  description: "Support ticket chat and triage, with LLM and decision-model strategies.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <strong>Kestrel Support</strong>
          <Link href="/">Chat</Link>
          <Link href="/triage">Triage</Link>
          <Link href="/smoke">Smoke test</Link>
          <Link href="/admin">Admin</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
