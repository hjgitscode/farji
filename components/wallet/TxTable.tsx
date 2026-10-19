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

const STATUS_NOTE: Record<string, string> = {
  PENDING: "waiting to be mined",
  CONFIRMED: "mined, not final yet — not treated as evidence",
  FINALIZED: "final",
  FAILED: "failed on-chain",
  DROPPED: "replaced or dropped",
};

/** Operational transaction status. This is NOT a verification state. */
export function TxTable({ rows, sync }: { rows: TxRow[]; sync: (txId: string) => Promise<AcceptResult> }) {
  if (rows.length === 0) return <p className="text-sm text-neutral-700">No transactions yet.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.id} className="space-y-1 rounded border border-neutral-200 p-3 text-sm">
          <p className="font-medium">
            {r.purpose.toLowerCase().replaceAll("_", " ")} · {r.status} <span className="font-normal text-neutral-600">({STATUS_NOTE[r.status] ?? ""})</span>
          </p>
          <p className="text-neutral-700">
            {r.organisation?.displayName ? `${r.organisation.displayName} · ` : ""}tx {short(r.txHash)} · from {short(r.fromAddress)}
            {r.blockNumber !== null ? ` · block ${r.blockNumber.toString()}` : ""} · submitted {r.submittedAt.toISOString().slice(0, 19).replace("T", " ")}
          </p>
          {r.failureReason ? <p className="text-red-700">{r.failureReason}</p> : null}
          {r.status === "PENDING" || r.status === "CONFIRMED" ? <ActionButton label="Check status" action={sync.bind(null, r.id)} /> : null}
        </li>
      ))}
    </ul>
  );
}
