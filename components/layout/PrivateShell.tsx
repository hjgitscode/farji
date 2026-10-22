import Link from "next/link";
import { signOutAction } from "@/lib/auth/actions";
import { Icon } from "@/components/ui/Icon";
import { Logo } from "@/components/ui/Logo";
import { configuredChainInfo } from "@/server/chain/queries";
import { NavLinks, type NavItem } from "./nav";

export type { NavItem };
type Role = "candidate" | "issuer" | "admin";

const ROLE: Record<Role, { label: string; home: string }> = {
  candidate: { label: "Candidate", home: "/candidate" },
  issuer: { label: "Issuer workspace", home: "/issuer" },
  admin: { label: "Administration", home: "/admin" },
};
const NETWORK: Record<string, string> = { "11155111": "Sepolia test network", "31337": "Local network" };

function SignOut({ className }: { className: string }) {
  return (
    <form action={signOutAction}>
      <button type="submit" className={className}>
        <Icon name="logout" className="size-4" />
        Sign out
      </button>
    </form>
  );
}

function NetworkPill() {
  const chain = configuredChainInfo();
  return (
    <p className="flex items-center gap-2 rounded-lg border border-nav-line bg-nav-raised px-3 py-2 text-xs text-neutral-400">
      <span className={`size-1.5 rounded-full ${chain ? "bg-emerald-400" : "bg-amber-400"}`} aria-hidden="true" />
      {chain ? (NETWORK[chain.chainId] ?? `Network ${chain.chainId}`) : "Network not configured"}
    </p>
  );
}

const MAIN = "mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:py-10";
const SKIP = "sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow-lift";

/**
 * Shell for private areas: navigation for the ONE area the user belongs to, plus sign-out. No cross-role links.
 * Issuer and admin get a left sidebar (operational workspace); the candidate gets a lighter top bar.
 */
export function PrivateShell({ children, nav = [], role }: { children: React.ReactNode; nav?: NavItem[]; role: Role }) {
  const r = ROLE[role];

  if (role === "candidate") {
    return (
      <div className="flex min-h-screen flex-col">
        <a href="#main" className={SKIP}>
          Skip to content
        </a>
        <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 sm:px-6">
            <Link href={r.home} className="py-3" aria-label="FARJI home">
              <Logo />
            </Link>
            <nav aria-label="Primary" className="-mb-px flex min-w-0 flex-1 overflow-x-auto py-2 [scrollbar-width:none]">
              <NavLinks items={nav} variant="top" />
            </nav>
            <SignOut className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900" />
          </div>
        </header>
        <main id="main" className={MAIN}>
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen lg:pl-64">
      <a href="#main" className={SKIP}>
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-nav lg:flex">
        <div className="flex items-center gap-2 px-5 pb-4 pt-5">
          <Link href={r.home} aria-label="FARJI home">
            <Logo inverse />
          </Link>
        </div>
        <p className="mx-5 mb-2 w-fit rounded-full bg-emerald-400/10 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-emerald-300">{r.label}</p>
        <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 pb-4">
          <NavLinks items={nav} variant="sidebar" />
        </nav>
        <div className="space-y-2 border-t border-nav-line p-3">
          <NetworkPill />
          <SignOut className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-neutral-400 transition hover:bg-nav-raised hover:text-white" />
        </div>
      </aside>

      <header className="sticky top-0 z-30 bg-nav lg:hidden">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
            <Logo inverse />
            <span className="flex items-center gap-2 text-sm font-medium text-neutral-300">
              {r.label}
              <Icon name="menu" className="size-5 group-open:hidden" />
              <Icon name="x" className="hidden size-5 group-open:block" />
            </span>
          </summary>
          <div className="max-h-[calc(100vh-3.5rem)] space-y-3 overflow-y-auto border-t border-nav-line px-3 pb-4 pt-2">
            <nav aria-label="Primary">
              <NavLinks items={nav} variant="sidebar" />
            </nav>
            <NetworkPill />
            <SignOut className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-neutral-400 transition hover:bg-nav-raised hover:text-white" />
          </div>
        </details>
      </header>

      <main id="main" className={`${MAIN} flex flex-col`}>
        {children}
      </main>
    </div>
  );
}
