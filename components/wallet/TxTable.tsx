import { EmptyState, Icon, Mono, StatusPill } from "@/components/ui";
import { explorerTxUrl, formatDateTime } from "@/lib/format";
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
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-card">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50 text-xs font-medium uppercase tracking-wide text-neutral-500">
          <tr>
            <th scope="col" className="px-4 py-2.5">Activity</th>
            <th scope="col" className="px-4 py-2.5">Status</th>
            <th scope="col" className="px-4 py-2.5">Transaction</th>
            <th scope="col" className="px-4 py-2.5">Submitted</th>
            <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 align-top">
          {rows.map((r) => {
            const s = TX_STATUS[r.status] ?? { tone: "neutral" as const, label: r.status, note: "", icon: "circle" as const };
            const explorer = explorerTxUrl(NETWORK_ID, r.txHash);
            const open = r.status === "PENDING" || r.status === "CONFIRMED";
            return (
              <tr key={r.id}>
                <td className="px-4 py-3">
                  <p className="font-semibold text-neutral-900">{PURPOSE[r.purpose] ?? r.purpose.toLowerCase().replaceAll("_", " ")}</p>
                  {r.organisation?.displayName ? <p className="text-xs text-neutral-500">{r.organisation.displayName.trim()}</p> : null}
                  {r.failureReason ? <p className="mt-1 text-xs text-rose-700">{r.failureReason}</p> : null}
                </td>
                <td className="px-4 py-3">
                  <StatusPill display={s} />
                  <p className="mt-1 max-w-[16rem] text-xs text-neutral-500">{s.note}</p>
                </td>
                <td className="space-y-1 px-4 py-3 text-xs text-neutral-500">
                  <p>
                    <Mono>{short(r.txHash)}</Mono>
                  </p>
                  <p>
                    From <Mono>{short(r.fromAddress)}</Mono>
                    {r.blockNumber !== null ? ` · block ${r.blockNumber.toString()}` : ""}
                  </p>
                  {explorer ? (
                    <a href={explorer} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-emerald-800 hover:underline">
                      View on explorer
                      <Icon name="external" className="size-3" />
                    </a>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">
                  {formatDateTime(r.submittedAt)}
                  {r.finalizedAt ? <span className="block">Final {formatDateTime(r.finalizedAt)}</span> : null}
                </td>
                <td className="px-4 py-3 text-right">{open ? <ActionButton label="Check status" icon="refresh" action={sync.bind(null, r.id)} /> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
