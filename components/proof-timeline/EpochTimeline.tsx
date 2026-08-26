import { Badge } from "@/components/ui/Badge";
import type { Attestation } from "@/lib/mock-data/types";

const GENESIS_ROOT = `0x${"0".repeat(64)}`;

function truncateHex(hex: string) {
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}

// Renders a chronological chain of attestations for one organisation +
// attestation type, showing how each epoch's previousChainRoot links back
// to the prior epoch's chainRoot — the "chained Merkle attestations"
// novelty described in docs/ARCHITECTURE.md section 9.
export function EpochTimeline({ epochs }: { epochs: Attestation[] }) {
  const sorted = [...epochs].sort((a, b) => a.epoch - b.epoch);

  return (
    <ol className="space-y-3">
      {sorted.map((epoch, index) => {
        const previous = sorted[index - 1];
        const linked = previous
          ? epoch.previousChainRoot === previous.chainRoot
          : epoch.previousChainRoot === GENESIS_ROOT;

        return (
          <li key={epoch.attestationId} className="rounded-md border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">
                Epoch {epoch.epoch} — {epoch.label}
              </p>
              <Badge tone={linked ? "green" : "red"}>
                {linked ? "Chain continuity intact" : "Chain continuity broken"}
              </Badge>
            </div>
            <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-slate-500 sm:grid-cols-2">
              <dt>Anchored</dt>
              <dd>{epoch.anchoredAt}</dd>
              <dt>Batch root</dt>
              <dd className="font-mono">{truncateHex(epoch.batchRoot)}</dd>
              <dt>Previous chain root</dt>
              <dd className="font-mono">{truncateHex(epoch.previousChainRoot)}</dd>
              <dt>Chain root</dt>
              <dd className="font-mono">{truncateHex(epoch.chainRoot)}</dd>
            </dl>
          </li>
        );
      })}
    </ol>
  );
}
