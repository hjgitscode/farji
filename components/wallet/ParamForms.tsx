"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { btn } from "@/components/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { AcceptResult, BuildResult, PrepareResult, RecordResult } from "./WalletButtons";
import { connectWallet, refuse, sendTransaction, signTypedData, walletMessage } from "./wallet";

// Wallet forms that take ONE free parameter from the person (a wallet address, a date, a reason).
// Everything else about the transaction/signature is built on the server.

const input = "rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm";
const button = btn.primary;

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await fn());
      router.refresh();
    } catch (e) {
      setError(walletMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, error, run };
}

function Status({ message, error }: { message: string | null; error: string | null }) {
  return (
    <>
      {message ? <p role="status" className="text-sm text-emerald-800">{message}</p> : null}
      {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
    </>
  );
}

type Option = { value: string; label: string };

/** One parameter (text, date-time or a choice) -> server builds the transaction -> the wallet broadcasts -> the server records. */
export function ParamTxButton({
  label,
  chainId,
  paramName,
  placeholder,
  kind = "text",
  options,
  build,
  record,
  confirm,
}: {
  label: string;
  chainId: string;
  paramName: string;
  /** When set, the person must confirm in a dialog first (used for exceptional or destructive actions). */
  confirm?: { title: string; body: string; danger?: boolean };
  placeholder?: string;
  kind?: "text" | "datetime" | "choice";
  options?: Option[];
  build: (raw: Record<string, string>) => Promise<BuildResult>;
  record: (txHash: string) => Promise<RecordResult>;
}) {
  const { busy, message, error, run } = useRun();
  const [value, setValue] = useState(options?.[0]?.value ?? "");
  const go = () =>
    run(async () => {
              // A date-time is converted to unix seconds here; the server re-validates every bound.
              const param = kind === "datetime" ? String(Math.floor(new Date(value).getTime() / 1000)) : value.trim();
              const account = await connectWallet(chainId);
              const built = await build({ [paramName]: param });
              if (!built.ok) refuse(built.error);
              if (built.warnings.length > 0 && !window.confirm(built.warnings.join("\n\n"))) refuse("Cancelled. Nothing was sent.");
              const hash = await sendTransaction(account, built);
              const recorded = await record(hash);
              if (!recorded.ok) refuse(recorded.error);
              return recorded.message;
            });
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {kind === "choice" ? (
          <select aria-label={paramName} className={input} value={value} onChange={(e) => setValue(e.target.value)}>
            {options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input aria-label={paramName} className={input} type={kind === "datetime" ? "datetime-local" : "text"} placeholder={placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
        )}
        {confirm ? (
          <ConfirmDialog trigger={busy ? "Waiting for your wallet…" : label} title={confirm.title} body={confirm.body} confirmLabel={label} tone={confirm.danger ? "danger" : "primary"} disabled={busy || !value} onConfirm={go} />
        ) : (
          <button type="button" className={button} disabled={busy || !value} onClick={go}>
            {busy ? "Waiting for your wallet…" : label}
          </button>
        )}
      </div>
      <Status message={message} error={error} />
    </div>
  );
}

/** Ends a CONTINUING relationship: the issuer picks the end date; the wallet signs the server-built StatusChangeAttestation. */
export function EndRelationshipButton({
  chainId,
  prepare,
  accept,
}: {
  chainId: string;
  prepare: (endDate: string) => Promise<PrepareResult>;
  accept: (signature: string, echo: { issuedAt: string; nonce: string; effectiveAt?: string }) => Promise<AcceptResult>;
}) {
  const { busy, message, error, run } = useRun();
  const [date, setDate] = useState("");
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="End date" className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <ConfirmDialog
          trigger={busy ? "Waiting for your wallet…" : "End relationship"}
          title="End this relationship?"
          body={`You are recording that this relationship ended on ${date || "the chosen date"}. The record stays on the person's profile as ended; it is not a revocation and nothing is deleted. This cannot be undone.`}
          confirmLabel="Sign and end relationship"
          disabled={busy || !date}
          onConfirm={() =>
            run(async () => {
              const account = await connectWallet(chainId);
              const prep = await prepare(date);
              if (!prep.ok) refuse(prep.error);
              const signature = await signTypedData(account, prep.walletTypedData);
              const done = await accept(signature, { issuedAt: prep.issuedAt, nonce: prep.nonce, effectiveAt: prep.effectiveAt });
              if (!done.ok) refuse(done.error);
              return done.message;
            })
          }
        />
      </div>
      <Status message={message} error={error} />
    </div>
  );
}
