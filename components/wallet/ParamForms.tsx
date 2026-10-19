"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AcceptResult, BuildResult, PrepareResult, RecordResult } from "./WalletButtons";
import { connectWallet, sendTransaction, signTypedData, walletMessage } from "./wallet";

// Wallet forms that take ONE free parameter from the person (a wallet address, a date, a reason).
// Everything else about the transaction/signature is built on the server.

const input = "rounded border border-neutral-300 px-2 py-1.5 text-sm";
const button = "rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-60";

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
      {message ? <p role="status" className="text-sm text-green-800">{message}</p> : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
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
}: {
  label: string;
  chainId: string;
  paramName: string;
  placeholder?: string;
  kind?: "text" | "datetime" | "choice";
  options?: Option[];
  build: (raw: Record<string, string>) => Promise<BuildResult>;
  record: (txHash: string) => Promise<RecordResult>;
}) {
  const { busy, message, error, run } = useRun();
  const [value, setValue] = useState(options?.[0]?.value ?? "");
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
        <button
          type="button"
          className={button}
          disabled={busy || !value}
          onClick={() =>
            run(async () => {
              // A date-time is converted to unix seconds here; the server re-validates every bound.
              const param = kind === "datetime" ? String(Math.floor(new Date(value).getTime() / 1000)) : value.trim();
              const account = await connectWallet(chainId);
              const built = await build({ [paramName]: param });
              if (!built.ok) throw new Error(built.error);
              if (built.warnings.length > 0 && !window.confirm(built.warnings.join("\n\n"))) throw new Error("Cancelled.");
              const hash = await sendTransaction(account, built);
              const recorded = await record(hash);
              if (!recorded.ok) throw new Error(recorded.error);
              return recorded.message;
            })
          }
        >
          {busy ? "Waiting for the wallet…" : label}
        </button>
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
        <button
          type="button"
          className={button}
          disabled={busy || !date}
          onClick={() =>
            run(async () => {
              const account = await connectWallet(chainId);
              const prep = await prepare(date);
              if (!prep.ok) throw new Error(prep.error);
              const signature = await signTypedData(account, prep.walletTypedData);
              const done = await accept(signature, { issuedAt: prep.issuedAt, nonce: prep.nonce, effectiveAt: prep.effectiveAt });
              if (!done.ok) throw new Error(done.error);
              return done.message;
            })
          }
        >
          {busy ? "Waiting for the wallet…" : "End relationship"}
        </button>
      </div>
      <Status message={message} error={error} />
    </div>
  );
}
