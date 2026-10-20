import { StatusBadge } from "@/components/ui";
import { presentState, type Audience } from "@/lib/verification/present";
import type { VerificationResult } from "@/lib/verification/types";

// Shows a DERIVED verification state (Phase 10) in plain language. The result carries no private material, so everything
// in it may be shown. Technical evidence stays behind "View verification details" and is expressed in plain sentences.

export function VerificationStatus({
  result,
  available,
  detail = false,
  audience = "owner",
}: {
  result: VerificationResult | null | undefined;
  available: boolean;
  detail?: boolean;
  audience?: Audience;
}) {
  if (!available) return <p className="text-sm text-neutral-600">Verification status is unavailable right now.</p>;
  if (!result) return null;
  const p = presentState(result, audience);
  return (
    <div className="space-y-1.5 text-sm" data-verification-state={result.state}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge presentation={p} />
        <p className="font-medium text-neutral-900">{p.headline}</p>
      </div>
      {detail ? (
        <>
          <p className="text-neutral-700">{p.explanation}</p>
          {result.state !== "SELF_DECLARED" && result.checks.length > 0 ? (
            <details className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
              <summary className="cursor-pointer font-medium text-neutral-800">View verification details</summary>
              <ul className="mt-2 space-y-1 text-neutral-700">
                {result.checks.map((c, i) => (
                  <li key={`${c.id}-${i}`} className="flex gap-2">
                    <span aria-hidden="true">{c.status === "PASS" ? "✓" : c.status === "FAIL" ? "×" : "…"}</span>
                    <span>
                      <span className="sr-only">{c.status === "PASS" ? "Passed: " : c.status === "FAIL" ? "Failed: " : "Waiting: "}</span>
                      {c.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
