"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";

export type NavItem = { href: string; label: string; icon: IconName; group?: string };

/** A role's navigation with a clear active state. `/issuer`-style root links match exactly; deeper links match their subtree. */
export function NavLinks({ items, variant }: { items: NavItem[]; variant: "sidebar" | "top" }) {
  const pathname = usePathname();
  const active = (href: string) => (href.split("/").length === 2 ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  if (variant === "top") {
    return (
      <ul className="flex items-center gap-1">
        {items.map((item) => {
          const on = active(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${on ? "bg-emerald-50 text-emerald-800" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"}`}
              >
                <Icon name={item.icon} className={`size-4 ${on ? "text-emerald-700" : "text-neutral-400"}`} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className="space-y-0.5">
      {items.map((item, i) => {
        const on = active(item.href);
        const heading = item.group && item.group !== items[i - 1]?.group ? item.group : null;
        return (
          <li key={item.href}>
            {heading ? <p className="px-3 pb-1 pt-4 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-neutral-500">{heading}</p> : null}
            <Link
              href={item.href}
              aria-current={on ? "page" : undefined}
              className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                on ? "bg-nav-raised text-white before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-emerald-400" : "text-neutral-400 hover:bg-nav-raised/70 hover:text-white"
              }`}
            >
              <Icon name={item.icon} className={`size-[1.05rem] ${on ? "text-emerald-400" : "text-neutral-500"}`} />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
