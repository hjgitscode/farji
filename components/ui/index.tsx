import Link from "next/link";
import type { StatePresentation, Tone } from "@/lib/verification/present";

// Shared presentation primitives (server-safe: no hooks). One look for cards, badges, alerts and forms so every
// area of the product reads the same. Colour is never the only cue: badges carry a glyph and a word.

const TONE: Record<Tone, string> = {
  verified: "bg-emerald-50 text-emerald-900 ring-emerald-200",
  current: "bg-sky-50 text-sky-900 ring-sky-200",
  attention: "bg-amber-50 text-amber-900 ring-amber-300",
  pending: "bg-indigo-50 text-indigo-900 ring-indigo-200",
  neutral: "bg-neutral-100 text-neutral-800 ring-neutral-300",
  danger: "bg-rose-50 text-rose-900 ring-rose-300",
  muted: "bg-slate-100 text-slate-800 ring-slate-300",
};

export function StatusBadge({ presentation, className = "" }: { presentation: Pick<StatePresentation, "tone" | "badge" | "icon">; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[presentation.tone]} ${className}`}>
      <span aria-hidden="true">{presentation.icon}</span>
      {presentation.badge}
    </span>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[tone]}`}>{children}</span>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-neutral-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ children, className = "", as: Tag = "div" }: { children: React.ReactNode; className?: string; as?: "div" | "li" | "section" | "article" }) {
  return <Tag className={`rounded-xl border border-neutral-200 bg-white p-4 shadow-sm ${className}`}>{children}</Tag>;
}

export function Section({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
        {description ? <p className="text-sm text-neutral-600">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, tone = "neutral", href }: { label: string; value: number | string; tone?: Tone; href?: string }) {
  const inner = (
    <Card className="h-full">
      <p className="text-sm text-neutral-600">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
      <Badge tone={tone}>{label.split(" ")[0]}</Badge>
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function Alert({ tone = "info", children, title }: { tone?: "info" | "success" | "warning" | "error"; title?: string; children: React.ReactNode }) {
  const cls = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    warning: "border-amber-300 bg-amber-50 text-amber-900",
    error: "border-rose-300 bg-rose-50 text-rose-900",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>
      {title ? <p className="font-medium">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-6 py-10 text-center">
      <p className="font-medium text-neutral-900">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-md text-sm text-neutral-600">{children}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export const btn = {
  primary:
    "inline-flex items-center justify-center rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center rounded-lg bg-rose-700 px-4 py-2 text-sm font-medium text-white hover:bg-rose-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  link: "text-sm font-medium text-neutral-900 underline underline-offset-2 hover:text-neutral-600",
} as const;

export const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 disabled:bg-neutral-100";

export function TabNav({ items, current }: { items: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <nav aria-label="Sections" className="-mx-1 mb-5 flex flex-wrap gap-1">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === current ? "page" : undefined}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${i.key === current ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"}`}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/** A labelled definition list for evidence and detail panels. */
export function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {items
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-neutral-500">{k}</dt>
            <dd className="min-w-0 break-words text-neutral-900">{v}</dd>
          </div>
        ))}
    </dl>
  );
}
