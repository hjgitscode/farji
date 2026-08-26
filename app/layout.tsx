import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NotSoFarji",
  description: "A lifecycle-aware blockchain verification system for professional claims.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
