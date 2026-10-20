import { Badge, Card, EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { Tone } from "@/lib/verification/present";
import { ActionButton, type AcceptResult } from "./WalletButtons";

export type TxRow = {
  id: string;
  txHash: string;
  purpose: string;
  status: string;
  fromAddress: string;
  blockNumber: bigint | null;
  failureReason: string | null;
  submittedAt: Date;
  finalizedAt: Date | null;
  organisation: { displayName: string } | null;
};

export const short = (hex: string | null | undefined) => (hex ? `${hex.slice(0, 8)}…${hex.slice(-6)}` : "");

const PURPOSE: Record<string, string> = {
  REGISTER_ORGANISATION: "Organisation registered",
  SET_ORGANISATION_STATUS: "Organisation status changed",
  AUTHORISE_ISSUER_KEY: "Issuer wallet authorised",
  RETIRE_ISSUER_KEY: "Issuer wallet retired or rotated",
  MARK_ISSUER_KEY_COMPROMISED: "Issuer wallet marked compromised",
  ANCHOR_COHORT: "Credential batch anchored",
  ANCHOR_PROOF_PULSE: "Current relationships confirmed",
  REVOKE_CREDENTIAL: "Credential revoked",
};

const STATUS: Record<string, { tone: Tone; label: string; note: string }> = {
  PENDING: { tone: "pending", label: "Pending", note: "Submitted. Waiting to be recorded." },
  CONFIRMED: { tone: "attention", label: "Recorded, not final", note: "Recorded but not final yet, so it does not count as evidence." },
  FINALIZED: { tone: "verified", label: "Final", note: "Final. This now counts." },
  FAILED: { tone: "danger", label: "Failed", note: "The network rejected it. Nothing changed; you can try again." },
  DROPPED: { tone: "danger", label: "Replaced or dropped", note: "It was replaced or never recorded. Nothing changed; you can try again." },
};

/** Operational transaction status. This is NOT a verification state. */
export function TxTable({ rows, sync }: { rows: TxRow[]; sync: (txId: string) => Promise<AcceptResult> }) {
  if (rows.length === 0) return <EmptyState title="No activity yet">Signing, anchoring and revocations appear here.</EmptyState>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const s = STATUS[r.status] ?? { tone: "neutral" as Tone, label: r.status, note: "" };
        return (
          <Card as="li" key={r.id} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{PURPOSE[r.purpose] ?? r.purpose.toLowerCase().replaceAll("_", " ")}</p>
              <Badge tone={s.tone}>{s.label}</Badge>
            </div>
            <p className="text-sm text-neutral-600">{s.note}</p>
            <p className="text-xs text-neutral-500">
              {r.organisation?.displayName ? `${r.organisation.displayName} · ` : ""}submitted {formatDateTime(r.submittedAt)}
              {r.blockNumber !== null ? ` · block ${r.blockNumber.toString()}` : ""}
            </p>
            <details className="text-xs text-neutral-500">
              <summary className="cursor-pointer">Technical details</summary>
              <p className="mt-1 break-all">
                Transaction {short(r.txHash)} · from {short(r.fromAddress)}
              </p>
            </details>
            {r.failureReason ? <p className="text-sm text-rose-700">{r.failureReason}</p> : null}
            {r.status === "PENDING" || r.status === "CONFIRMED" ? <ActionButton label="Check status" action={sync.bind(null, r.id)} /> : null}
          </Card>
        );
      })}
    </ul>
  );
}
