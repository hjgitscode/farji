"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Home" },
  { href: "/candidate", label: "Candidate Demo" },
  { href: "/issuer", label: "Issuer Demo" },
  { href: "/admin", label: "Admin Demo" },
  { href: "/proofpulse", label: "ProofPulse" },
  { href: "/cohortproof", label: "CohortProof" },
  { href: "/verify", label: "Verify a Credential" },
  { href: "/technology", label: "Technology" },
  { href: "/novelty", label: "Novelty" },
  { href: "/contract-explorer", label: "Contract Explorer" },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="text-lg font-bold text-slate-900">
          NotSoFarji
        </Link>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={active ? "font-semibold text-brand" : "text-slate-600 hover:text-brand"}
              >
                {link.label}
              </Link>
            );
          })}
          <Link
            href="/developers"
            className={
              pathname === "/developers"
                ? "font-semibold text-brand"
                : "border-l border-slate-200 pl-4 text-slate-600 hover:text-brand"
            }
          >
            Developers
          </Link>
        </nav>
      </div>
    </header>
  );
}
