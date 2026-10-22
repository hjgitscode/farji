import Link from "next/link";
import type { StatePresentation, Tone } from "@/lib/verification/present";
import { Icon, Spinner, type IconName } from "./Icon";

export { Icon, Spinner };
export type { IconName };

// Shared presentation primitives (server-safe: no hooks). One look for cards, badges, alerts, tables and forms so every
// area of the product reads the same. Colour is never the only cue: badges carry an icon and a word.

const TONE: Record<Tone, string> = {
  verified: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  current: "bg-teal-50 text-teal-800 ring-teal-200",
  attention: "bg-amber-50 text-amber-900 ring-amber-300",
  pending: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  neutral: "bg-neutral-100 text-neutral-700 ring-neutral-300",
  danger: "bg-rose-50 text-rose-800 ring-rose-300",
  muted: "bg-slate-100 text-slate-700 ring-slate-300",
};

/** Tinted square behind an icon (stat cards, empty states). */
export const TONE_ICON: Record<Tone, string> = {
  verified: "bg-emerald-100 text-emerald-700",
  current: "bg-teal-100 text-teal-700",
  attention: "bg-amber-100 text-amber-800",
  pending: "bg-indigo-100 text-indigo-700",
  neutral: "bg-neutral-100 text-neutral-600",
  danger: "bg-rose-100 text-rose-700",
  muted: "bg-slate-100 text-slate-600",
};

/** The icon that stands for a record category. */
export function categoryIcon(category: string): IconName {
  return category === "EDUCATION" ? "graduation" : category === "CERTIFICATION" ? "award" : category === "MEMBERSHIP" ? "users" : "briefcase";
}

const GLYPH_ICON: Record<StatePresentation["icon"], IconName> = { "✓": "check", "●": "dot", "!": "alert", "○": "circle", "×": "x", "…": "clock" };

export function StatusBadge({ presentation, className = "", size = "sm" }: { presentation: Pick<StatePresentation, "tone" | "badge" | "icon">; className?: string; size?: "sm" | "lg" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium ring-1 ring-inset ${size === "lg" ? "px-3.5 py-1.5 text-sm" : "px-2.5 py-1 text-xs"} ${TONE[presentation.tone]} ${className}`}
    >
      <Icon name={GLYPH_ICON[presentation.icon]} className={size === "lg" ? "size-4" : "size-3.5"} strokeWidth={2.25} />
      {presentation.badge}
    </span>
  );
}

export function Badge({ tone = "neutral", children, icon, className = "" }: { tone?: Tone; children: React.ReactNode; icon?: IconName; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${TONE[tone]} ${className}`}>
      {icon ? <Icon name={icon} className="size-3.5" strokeWidth={2.25} /> : null}
      {children}
    </span>
  );
}

/** A workflow or transaction status (never a verification state): icon + word, with a calm tone. */
export function StatusPill({ display, className = "" }: { display: { tone: Tone; label: string; icon: IconName }; className?: string }) {
  return (
    <Badge tone={display.tone} icon={display.icon} className={className}>
      {display.label}
    </Badge>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">{eyebrow}</p> : null}
        <h1 className="text-[1.65rem] font-semibold leading-tight tracking-tight text-neutral-900">{title}</h1>
        {description ? <p className="max-w-2xl text-sm leading-relaxed text-neutral-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className = "",
  as: Tag = "div",
  interactive = false,
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "li" | "section" | "article";
  interactive?: boolean;
}) {
  return (
    <Tag className={`rounded-xl border border-neutral-200 bg-white p-4 shadow-card sm:p-5 ${interactive ? "transition duration-150 hover:-translate-y-px hover:border-neutral-300 hover:shadow-lift" : ""} ${className}`}>
      {children}
    </Tag>
  );
}

/** A card with its own header row (title, optional description and action) and a body. */
export function Panel({ title, description, action, children, className = "" }: { title: string; description?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-card ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-neutral-500">{description}</p> : null}
        </div>
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function Section({ title, description, children, action }: { title: string; description?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-3.5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold tracking-tight text-neutral-900">{title}</h2>
          {description ? <p className="text-sm text-neutral-600">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  tone = "neutral",
  href,
  icon,
  hint,
}: {
  label: string;
  value: number | string;
  tone?: Tone;
  href?: string;
  icon?: IconName;
  hint?: string;
}) {
  const inner = (
    <Card interactive={Boolean(href)} className="h-full">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-neutral-500">{label}</p>
          <p className="mt-1.5 text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums text-neutral-900">{value}</p>
          {hint ? <p className="mt-1.5 text-xs text-neutral-500">{hint}</p> : null}
        </div>
        {icon ? (
          <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${TONE_ICON[tone]}`}>
            <Icon name={icon} className="size-[1.1rem]" />
          </span>
        ) : null}
      </div>
    </Card>
  );
  return href ? (
    <Link href={href} className="block h-full rounded-xl focus-visible:outline-2">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function Alert({ tone = "info", children, title }: { tone?: "info" | "success" | "warning" | "error"; title?: string; children: React.ReactNode }) {
  const cfg = {
    info: { box: "border-sky-200 bg-sky-50 text-sky-950", icon: "text-sky-600", name: "alert" as IconName },
    success: { box: "border-emerald-200 bg-emerald-50 text-emerald-950", icon: "text-emerald-600", name: "check" as IconName },
    warning: { box: "border-amber-300 bg-amber-50 text-amber-950", icon: "text-amber-600", name: "alert" as IconName },
    error: { box: "border-rose-300 bg-rose-50 text-rose-950", icon: "text-rose-600", name: "x" as IconName },
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${cfg.box}`}>
      <Icon name={cfg.name} className={`mt-0.5 size-4 ${cfg.icon}`} strokeWidth={2.25} />
      <div className="min-w-0 space-y-0.5">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className="leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action, icon = "inbox" }: { title: string; children?: React.ReactNode; action?: React.ReactNode; icon?: IconName }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-white/60 px-6 py-10 text-center">
      <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
        <Icon name={icon} className="size-5" />
      </span>
      <p className="mt-3 font-semibold text-neutral-900">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-neutral-600">{children}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

const BTN_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export const btn = {
  primary: `${BTN_BASE} bg-emerald-700 text-white shadow-sm hover:bg-emerald-800 active:bg-emerald-900 focus-visible:outline-emerald-700`,
  secondary: `${BTN_BASE} border border-neutral-300 bg-white text-neutral-900 shadow-sm hover:border-neutral-400 hover:bg-neutral-50 focus-visible:outline-neutral-700`,
  danger: `${BTN_BASE} bg-rose-700 text-white shadow-sm hover:bg-rose-800 focus-visible:outline-rose-700`,
  dark: `${BTN_BASE} bg-neutral-900 text-white shadow-sm hover:bg-neutral-700 focus-visible:outline-neutral-900`,
  link: "text-sm font-medium text-emerald-800 underline decoration-emerald-300 underline-offset-4 transition hover:text-emerald-900 hover:decoration-emerald-600",
} as const;

export const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm placeholder:text-neutral-400 transition focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20 disabled:bg-neutral-100";

export function TabNav({ items, current }: { items: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <nav aria-label="Sections" className="mb-5 inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-neutral-200 bg-white p-1 shadow-card">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === current ? "page" : undefined}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${i.key === current ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"}`}
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
    <dl className="grid grid-cols-1 gap-x-8 gap-y-2.5 text-sm sm:grid-cols-[max-content_1fr]">
      {items
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-neutral-500">{k}</dt>
            <dd className="min-w-0 break-words font-medium text-neutral-900">{v}</dd>
          </div>
        ))}
    </dl>
  );
}

/** Technical detail behind a disclosure. Collapsed by default. */
export function Disclosure({ summary, children, className = "", tone = "card", defaultOpen = false }: { summary: React.ReactNode; children: React.ReactNode; className?: string; tone?: "card" | "plain"; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen || undefined} className={`group ${tone === "card" ? "rounded-xl border border-neutral-200 bg-white shadow-card" : ""} ${className}`}>
      <summary
        className={`flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-neutral-800 transition hover:text-neutral-950 [&::-webkit-details-marker]:hidden ${tone === "card" ? "px-4 py-3" : "py-1"}`}
      >
        <span>{summary}</span>
        <Icon name="chevron-down" className="size-4 text-neutral-500 transition-transform duration-150 group-open:rotate-180" />
      </summary>
      <div className={tone === "card" ? "border-t border-neutral-100 px-4 py-4" : "pt-2"}>{children}</div>
    </details>
  );
}

/** Hashes, addresses and identifiers: monospace, wrapping, never overflowing. */
export function Mono({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <code className={`break-all rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[0.72rem] text-neutral-700 ${className}`}>{children}</code>;
}

/** A divided list container (rows are `<li>`s that bring their own padding). */
export function RowList({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <ul className={`divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-card ${className}`}>{children}</ul>;
}

export type StepState = "done" | "current" | "todo";

/** A horizontal progress tracker. Steps are workflow stages (plain text, not controls), never verification states. */
export function Stepper({ steps, label }: { steps: { label: string; state: StepState }[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-wrap items-center gap-y-1.5 text-xs">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center" aria-current={s.state === "current" ? "step" : undefined}>
          <span className={`flex items-center gap-1.5 font-medium ${s.state === "todo" ? "text-neutral-400" : s.state === "current" ? "text-neutral-900" : "text-emerald-800"}`}>
            <span
              className={`flex size-5 items-center justify-center rounded-full text-[0.65rem] font-semibold tabular-nums ${
                s.state === "done" ? "bg-emerald-600 text-white" : s.state === "current" ? "bg-white text-neutral-900 ring-2 ring-neutral-900" : "bg-neutral-100 text-neutral-400"
              }`}
            >
              {s.state === "done" ? <Icon name="check" className="size-3" strokeWidth={3} /> : i + 1}
            </span>
            {s.label}
            <span className="sr-only">{s.state === "done" ? " (done)" : s.state === "current" ? " (current step)" : " (not yet)"}</span>
          </span>
          {i < steps.length - 1 ? <span aria-hidden="true" className={`mx-2.5 h-px w-5 sm:w-7 ${s.state === "done" ? "bg-emerald-300" : "bg-neutral-300"}`} /> : null}
        </li>
      ))}
    </ol>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-shimmer rounded-lg bg-neutral-200/70 ${className}`} />;
}
