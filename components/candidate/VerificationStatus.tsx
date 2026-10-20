import { stateLabel, timingLines } from "@/lib/verification/labels";
import type { VerificationResult } from "@/lib/verification/types";

// Minimal functional display of a DERIVED verification state (Phase 10). Visual polish is Phase 11-13.
// The result carries no private material, so everything in it may be shown to the candidate.

export function VerificationStatus({ result, available, detail = false }: { result: VerificationResult | undefined; available: boolean; detail?: boolean }) {
  if (!available) return <p className="text-sm text-neutral-600">Verification status is unavailable right now.</p>;
  if (!result) return null;
  const timing = timingLines(result);
  return (
    <div className="space-y-1 text-sm" data-verification-state={result.state}>
      <p className="font-medium">{stateLabel(result)}</p>
      {detail ? (
        <>
          {result.reasons.length > 0 ? (
            <ul className="list-disc pl-5 text-neutral-700">
              {result.reasons.map((r) => (
                <li key={r.code}>{r.message}</li>
              ))}
            </ul>
          ) : null}
          {timing.map((line) => (
            <p key={line} className="text-neutral-700">
              {line}
            </p>
          ))}
          {result.state !== "SELF_DECLARED" && result.state !== "PENDING" ? (
            <details className="text-neutral-700">
              <summary className="cursor-pointer">Checks</summary>
              <ul className="mt-1 space-y-0.5">
                {result.checks.map((c, i) => (
                  <li key={`${c.id}-${i}`}>
                    {c.status === "PASS" ? "✓" : c.status === "FAIL" ? "✗" : "·"} {c.detail}
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
