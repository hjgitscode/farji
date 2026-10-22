import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { btn } from "@/components/ui";

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow-lift">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-neutral-200/80 bg-white/85 backdrop-blur">
        <nav aria-label="Primary" className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" aria-label="FARJI home">
            <Logo />
          </Link>
          <ul className="flex items-center gap-1 text-sm sm:gap-2">
            <li>
              <Link href="/verify" className="rounded-lg px-3 py-2 font-medium text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900">
                <span className="sm:hidden">Verify</span>
                <span className="hidden sm:inline">Verify a credential</span>
              </Link>
            </li>
            <li>
              <Link href="/login" className="rounded-lg px-3 py-2 font-medium text-neutral-700 transition hover:bg-neutral-100 hover:text-neutral-900">
                Sign in
              </Link>
            </li>
            <li className="hidden sm:block">
              <Link href="/signup" className={btn.primary}>
                Create account
              </Link>
            </li>
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:py-12">
        {children}
      </main>
      <footer className="border-t border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-neutral-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <Logo className="[&>span:last-child]:text-sm" />
            <span className="hidden text-neutral-300 sm:inline" aria-hidden="true">
              |
            </span>
            <span>Because your resume should not be farji.</span>
          </div>
          <ul className="flex gap-4">
            <li>
              <Link href="/verify" className="hover:text-neutral-900">
                Verify a credential
              </Link>
            </li>
            <li>
              <Link href="/login" className="hover:text-neutral-900">
                Sign in
              </Link>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
