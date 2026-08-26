import type { Metadata } from "next";
import { NavBar } from "@/components/ui/NavBar";
import { Footer } from "@/components/ui/Footer";
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
      <body className="flex min-h-screen flex-col bg-white text-slate-900 antialiased">
        <NavBar />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
