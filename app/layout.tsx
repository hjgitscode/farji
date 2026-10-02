import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FARJI", template: "%s · FARJI" },
  description: "Professional credential verification that stays honest over time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
