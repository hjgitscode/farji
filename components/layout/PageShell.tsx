import Link from "next/link";

export type NavItem = { href: string; label: string };

export function PageShell({ nav, children }: { nav: NavItem[]; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:bg-white focus:p-2"
      >
        Skip to content
      </a>
      <header className="border-b border-neutral-200">
        <nav
          aria-label="Primary"
          className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-3"
        >
          <Link href="/" className="text-lg font-semibold tracking-tight">
            FARJI
          </Link>
          <ul className="flex flex-wrap items-center gap-4 text-sm">
            {nav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="hover:underline">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {children}
      </main>
      <footer className="border-t border-neutral-200 px-4 py-4 text-center text-xs text-neutral-600">
        FARJI
      </footer>
    </div>
  );
}
