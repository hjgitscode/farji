import Link from "next/link";
import { btn, Icon, StatusBadge } from "@/components/ui";

const LEGEND = [
  { tone: "verified", badge: "Verified", icon: "✓" },
  { tone: "current", badge: "Currently confirmed", icon: "✓" },
  { tone: "attention", badge: "Needs refresh", icon: "!" },
  { tone: "muted", badge: "Ended", icon: "○" },
  { tone: "danger", badge: "Revoked", icon: "×" },
] as const;

export default function HomePage() {
  return (
    <div className="mx-auto grid max-w-5xl items-center gap-12 py-6 lg:grid-cols-[1fr_26rem] lg:py-14">
      <div className="space-y-7">
        <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight text-neutral-900 sm:text-5xl">Credentials confirmed by the institutions behind them.</h1>
        <p className="max-w-md text-lg leading-relaxed text-neutral-600">Build a professional record, have employers and universities confirm it, and share a link anyone can check.</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/signup" className={btn.primary}>
            Create your profile
          </Link>
          <Link href="/verify" className={btn.secondary}>
            Verify a credential
          </Link>
        </div>
        <p className="text-sm text-neutral-500">
          Issuing for an organisation?{" "}
          <Link href="/login" className="font-medium text-neutral-900 underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lift" aria-label="Example of a verification result">
        <div className="flex items-center gap-3 border-b border-neutral-200 bg-emerald-800 px-5 py-4 text-white">
          <Icon name="shield-check" className="size-6" strokeWidth={1.6} />
          <div>
            <p className="text-xs font-medium text-emerald-100">Credential check · example</p>
            <p className="font-semibold leading-tight">Verified historical credential</p>
          </div>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-neutral-500">Record</span>
            <span className="font-medium">Software Engineer · Example Ltd</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-neutral-500">Confirmed by</span>
            <span className="font-medium">Example Ltd</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-neutral-500">Evidence</span>
            <span className="font-medium">Signed · anchored · final</span>
          </div>
        </div>
        <div className="border-t border-neutral-100 bg-neutral-50 px-5 py-4">
          <p className="mb-2.5 text-xs font-medium text-neutral-500">Every record is one of</p>
          <ul className="flex flex-wrap gap-1.5">
            {LEGEND.map((s) => (
              <li key={s.badge}>
                <StatusBadge presentation={s} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
