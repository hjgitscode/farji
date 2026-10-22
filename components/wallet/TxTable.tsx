import { Badge, EmptyState, Icon, Mono, StatusPill } from "@/components/ui";
import { explorerTxUrl, formatDateTime, NETWORK_NAME } from "@/lib/format";
import { TX_STATUS } from "@/lib/ui/status";
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

export const PURPOSE: Record<string, string> = {
  REGISTER_ORGANISATION: "Organisation registered",
  SET_ORGANISATION_STATUS: "Organisation status changed",
  AUTHORISE_ISSUER_KEY: "Issuer wallet authorised",
  RETIRE_ISSUER_KEY: "Issuer wallet retired or rotated",
  MARK_ISSUER_KEY_COMPROMISED: "Issuer wallet marked compromised",
  ANCHOR_COHORT: "Credential batch anchored",
  ANCHOR_PROOF_PULSE: "Current relationships confirmed",
  REVOKE_CREDENTIAL: "Credential revoked",
};

/** The configured network's name for explorer links; FARJI only publishes to one network at a time. */
const NETWORK_ID = process.env.FARJI_CHAIN_ID ?? "";

/** Operational transaction status. This is NOT a verification state. */
export function TxTable({ rows, sync }: { rows: TxRow[]; sync: (txId: string) => Promise<AcceptResult> }) {
  if (rows.length === 0) return <EmptyState title="No activity yet" icon="activity">Registrations, signing, anchoring and revocations appear here as soon as they are sent from a wallet.</EmptyState>;
  return (
    <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-card">
      {rows.map((r) => {
        const s = TX_STATUS[r.status] ?? { tone: "neutral" as const, label: r.status, note: "", icon: "circle" as const };
        const explorer = explorerTxUrl(NETWORK_ID, r.txHash);
        const open = r.status === "PENDING" || r.status === "CONFIRMED";
        return (
          <li key={r.id} className="space-y-2.5 px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0 space-y-0.5">
                <p className="font-semibold text-neutral-900">{PURPOSE[r.purpose] ?? r.purpose.toLowerCase().replaceAll("_", " ")}</p>
                <p className="text-xs text-neutral-500">
                  {r.organisation?.displayName ? `${r.organisation.displayName} · ` : ""}Submitted {formatDateTime(r.submittedAt)}
                  {r.finalizedAt ? ` · final ${formatDateTime(r.finalizedAt)}` : ""}
                </p>
              </div>
              <StatusPill display={s} />
            </div>
            <p className="text-sm text-neutral-600">{s.note}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-neutral-500">
              <span className="inline-flex items-center gap-1.5">
                Transaction <Mono>{short(r.txHash)}</Mono>
              </span>
              <span className="inline-flex items-center gap-1.5">
                Wallet <Mono>{short(r.fromAddress)}</Mono>
              </span>
              {r.blockNumber !== null ? <Badge>Block {r.blockNumber.toString()}</Badge> : null}
              {explorer ? (
                <a href={explorer} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-emerald-800 underline decoration-emerald-300 underline-offset-4 hover:text-emerald-900">
                  View on {NETWORK_NAME[NETWORK_ID] ?? "explorer"}
                  <Icon name="external" className="size-3" />
                </a>
              ) : null}
            </div>
            {r.failureReason ? <p className="text-sm text-rose-700">{r.failureReason}</p> : null}
            {open ? <ActionButton label="Check status" icon="refresh" action={sync.bind(null, r.id)} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
