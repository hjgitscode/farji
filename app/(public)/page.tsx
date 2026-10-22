import Link from "next/link";
import { btn, Card, Icon, StatusBadge, TONE_ICON, type IconName } from "@/components/ui";
import type { StatePresentation } from "@/lib/verification/present";

const STATES: { p: Pick<StatePresentation, "tone" | "badge" | "icon">; text: string }[] = [
  { p: { tone: "verified", badge: "Verified", icon: "✓" }, text: "The organisation confirmed it from its own records." },
  { p: { tone: "current", badge: "Currently confirmed", icon: "✓" }, text: "Recently re-confirmed as still current." },
  { p: { tone: "attention", badge: "Needs refresh", icon: "!" }, text: "Confirmed before, but not re-confirmed recently." },
  { p: { tone: "muted", badge: "Ended", icon: "○" }, text: "A genuine relationship that has finished." },
  { p: { tone: "danger", badge: "Revoked", icon: "×" }, text: "The organisation withdrew it." },
];

const AUDIENCES: { icon: IconName; title: string; body: string; href: string; cta: string }[] = [
  { icon: "user", title: "For professionals", body: "Keep your experience, education and certifications in one place and have the institutions behind them confirm what is true.", href: "/signup", cta: "Create your profile" },
  { icon: "building", title: "For institutions", body: "Confirm records from your own files, sign them with your organisation's authority, and keep them honest as relationships change.", href: "/login", cta: "Sign in to your workspace" },
  { icon: "search", title: "For anyone checking", body: "Open a link or scan a code and see, in seconds, whether a record is genuine, current, expired, ended or withdrawn.", href: "/verify", cta: "Verify a credential" },
];

const PRINCIPLES: { icon: IconName; title: string; body: string }[] = [
  { icon: "badge", title: "Confirmed by the source", body: "A record is only verified when the employer, university or licensing body itself vouches for it." },
  { icon: "shield-check", title: "Evidence anyone can check", body: "Each confirmation is signed and recorded on a public network, so it can be tested without trusting FARJI." },
  { icon: "history", title: "Honest over time", body: "Ongoing roles must be re-confirmed. Expiry, endings and withdrawals show up as what they are." },
];

export default function HomePage() {
  return (
    <div className="space-y-16 lg:space-y-24">
      <section className="relative -mx-4 overflow-hidden rounded-none bg-gradient-to-br from-emerald-950 via-emerald-900 to-emerald-800 px-4 py-12 text-white sm:mx-0 sm:rounded-3xl sm:px-10 sm:py-16 lg:px-14 lg:py-20">
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-emerald-400/10 blur-3xl" aria-hidden="true" />
        <div className="relative grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-emerald-100">
              <Icon name="shield-check" className="size-3.5" />
              Institution-backed professional credentials
            </p>
            <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">Professional credentials you can actually verify.</h1>
            <p className="max-w-xl text-lg leading-relaxed text-emerald-50/85">
              FARJI shows experience, education and certifications that the institutions themselves have confirmed, and tells you whether each one is still current, expired, ended or withdrawn.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/signup" className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-emerald-900 shadow-sm transition hover:bg-emerald-50">
                Create your profile
                <Icon name="arrow-right" className="size-4" />
              </Link>
              <Link href="/verify" className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/25 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">
                Verify a credential
              </Link>
            </div>
            <p className="text-sm text-emerald-100/70">
              Issuing for an organisation?{" "}
              <Link href="/login" className="font-medium text-white underline decoration-white/40 underline-offset-4 hover:decoration-white">
                Sign in
              </Link>
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white p-5 text-neutral-900 shadow-lift sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">How every record is read</p>
            <ul className="mt-4 space-y-3.5">
              {STATES.map((s) => (
                <li key={s.p.badge} className="flex items-start gap-3">
                  <span className="w-44 shrink-0">
                    <StatusBadge presentation={s.p} />
                  </span>
                  <span className="text-sm leading-snug text-neutral-600">{s.text}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 border-t border-neutral-100 pt-4 text-xs text-neutral-500">Self-declared records are always labelled as such. Nothing is shown as verified until it is.</p>
          </div>
        </div>
      </section>

      <section aria-label="Who FARJI is for" className="grid gap-4 md:grid-cols-3">
        {AUDIENCES.map((a) => (
          <Card key={a.title} interactive className="flex flex-col gap-3">
            <span className={`flex size-10 items-center justify-center rounded-lg ${TONE_ICON.verified}`}>
              <Icon name={a.icon} className="size-5" />
            </span>
            <h2 className="text-base font-semibold">{a.title}</h2>
            <p className="flex-1 text-sm leading-relaxed text-neutral-600">{a.body}</p>
            <Link href={a.href} className={`${btn.link} inline-flex items-center gap-1.5`}>
              {a.cta}
              <Icon name="arrow-right" className="size-3.5" />
            </Link>
          </Card>
        ))}
      </section>

      <section aria-label="Why it can be trusted" className="space-y-8">
        <div className="max-w-2xl space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Why verification matters</p>
          <h2 className="text-3xl font-semibold tracking-tight">A resume is a claim. FARJI makes it checkable.</h2>
          <p className="text-neutral-600">Anyone can write anything on a CV. Trust should come from the source, and stay accurate as things change.</p>
        </div>
        <ul className="grid gap-6 md:grid-cols-3">
          {PRINCIPLES.map((p) => (
            <li key={p.title} className="space-y-2 border-t-2 border-emerald-700 pt-4">
              <Icon name={p.icon} className="size-5 text-emerald-700" />
              <h3 className="font-semibold">{p.title}</h3>
              <p className="text-sm leading-relaxed text-neutral-600">{p.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
