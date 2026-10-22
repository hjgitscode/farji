import { Disclosure, Icon, StatusBadge } from "@/components/ui";
import { groupChecks } from "@/lib/verification/evidence-groups";
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
    <div className="space-y-2 text-sm" data-verification-state={result.state}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge presentation={p} />
        <p className="font-medium text-neutral-900">{p.headline}</p>
      </div>
      {detail ? (
        <>
          <p className="leading-relaxed text-neutral-700">{p.explanation}</p>
          {result.state !== "SELF_DECLARED" && result.checks.length > 0 ? (
            <Disclosure summary="View verification details">
              <div className="space-y-4">
                {groupChecks(result.checks).map((g) => (
                  <section key={g.id} className="space-y-1.5">
                    <h4 className="flex items-center gap-2 text-sm font-medium text-neutral-800">
                      <Icon name={g.icon} className="size-4 text-neutral-500" />
                      {g.title}
                    </h4>
                    <ul className="space-y-1 pl-6 text-neutral-700">
                      {g.checks.map((c, i) => (
                        <li key={`${c.id}-${i}`} className="flex gap-2">
                          <span aria-hidden="true" className={c.status === "PASS" ? "text-emerald-700" : c.status === "FAIL" ? "text-rose-700" : "text-neutral-400"}>
                            {c.status === "PASS" ? "✓" : c.status === "FAIL" ? "×" : "…"}
                          </span>
                          <span>
                            <span className="sr-only">{c.status === "PASS" ? "Passed: " : c.status === "FAIL" ? "Failed: " : "Waiting: "}</span>
                            {c.detail}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </Disclosure>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
