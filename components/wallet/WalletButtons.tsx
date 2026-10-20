"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { btn } from "@/components/ui";
import { connectWallet, sendTransaction, signTypedData, walletMessage } from "./wallet";

// Thin client components around the server actions. Every value that matters (typed data, calldata,
// targets) comes FROM the server action's result; the browser only returns account, signature, hash.

export type ActionFail = { ok: false; error: string };

export type BuildResult = ActionFail | { ok: true; to: string; data: string; chainId: string; warnings: string[] };
export type RecordResult = ActionFail | { ok: true; id: string; status: string; message: string };
export type PrepareResult = ActionFail | { ok: true; walletTypedData: unknown; issuedAt: string; nonce: string; effectiveAt?: string };
export type AcceptResult = ActionFail | { ok: true; message: string };

type Props = { label: string; chainId: string; disabled?: boolean };

function useRunner() {
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

const button = btn.primary;

/** Server builds the transaction -> the connected wallet broadcasts it -> the server records the hash. */
export function TxButton({ label, chainId, disabled, build, record }: Props & { build: () => Promise<BuildResult>; record: (txHash: string) => Promise<RecordResult> }) {
  const { busy, message, error, run } = useRunner();
  return (
    <div className="space-y-1">
      <button
        type="button"
        className={button}
        disabled={busy || disabled}
        onClick={() =>
          run(async () => {
            const account = await connectWallet(chainId);
            const built = await build();
            if (!built.ok) throw new Error(built.error);
            if (built.warnings.length > 0 && !window.confirm(built.warnings.join("\n\n"))) throw new Error("Cancelled.");
            const hash = await sendTransaction(account, built);
            const recorded = await record(hash);
            if (!recorded.ok) throw new Error(recorded.error);
            return recorded.message;
          })
        }
      >
        {busy ? "Waiting for your wallet…" : label}
      </button>
      <Status message={message} error={error} />
    </div>
  );
}

/** Server prepares typed data -> the wallet signs (EIP-712) -> the server verifies and accepts. */
export function SignButton({
  label,
  chainId,
  disabled,
  prepare,
  accept,
}: Props & {
  prepare: (account: string) => Promise<PrepareResult>;
  accept: (signature: string, echo: { account: string; issuedAt: string; nonce: string; effectiveAt?: string }) => Promise<AcceptResult>;
}) {
  const { busy, message, error, run } = useRunner();
  return (
    <div className="space-y-1">
      <button
        type="button"
        className={button}
        disabled={busy || disabled}
        onClick={() =>
          run(async () => {
            const account = await connectWallet(chainId);
            const prep = await prepare(account);
            if (!prep.ok) throw new Error(prep.error);
            const signature = await signTypedData(account, prep.walletTypedData);
            const done = await accept(signature, { account, issuedAt: prep.issuedAt, nonce: prep.nonce, effectiveAt: prep.effectiveAt });
            if (!done.ok) throw new Error(done.error);
            return done.message;
          })
        }
      >
        {busy ? "Waiting for your wallet…" : label}
      </button>
      <Status message={message} error={error} />
    </div>
  );
}

/** A plain server action button (no wallet), e.g. "Seal batch" or "Check status". */
export function ActionButton({ label, disabled, action }: { label: string; disabled?: boolean; action: () => Promise<AcceptResult> }) {
  const { busy, message, error, run } = useRunner();
  return (
    <div className="space-y-1">
      <button
        type="button"
        className={btn.secondary}
        disabled={busy || disabled}
        onClick={() =>
          run(async () => {
            const res = await action();
            if (!res.ok) throw new Error(res.error);
            return res.message;
          })
        }
      >
        {busy ? "Working…" : label}
      </button>
      <Status message={message} error={error} />
    </div>
  );
}
