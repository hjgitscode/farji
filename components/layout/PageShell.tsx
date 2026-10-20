import Link from "next/link";

export type NavItem = { href: string; label: string };

export function PageShell({ nav, children, actions, wide = false }: { nav: NavItem[]; children: React.ReactNode; actions?: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
        Skip to content
      </a>
      <header className="border-b border-neutral-200 bg-white">
        <nav aria-label="Primary" className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="text-lg font-semibold tracking-tight text-neutral-900">
            FARJI
          </Link>
          <ul className="flex flex-1 flex-wrap items-center gap-1 text-sm">
            {nav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="rounded-lg px-3 py-1.5 font-medium text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          {actions ? <div className="text-sm">{actions}</div> : null}
        </nav>
      </header>
      <main id="main" className={`mx-auto w-full flex-1 px-4 py-8 ${wide ? "max-w-6xl" : "max-w-5xl"}`}>
        {children}
      </main>
      <footer className="border-t border-neutral-200 bg-white px-4 py-4 text-center text-xs text-neutral-600">FARJI · institution-backed professional credentials</footer>
    </div>
  );
}
