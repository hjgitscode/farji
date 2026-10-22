import type { Metadata } from "next";
import { Alert, btn, Card, Icon, inputClass } from "@/components/ui";
import { lookupCredentialAction } from "./actions";

export const metadata: Metadata = { title: "Verify a credential" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ invalid?: string; limited?: string }> }) {
  const { invalid, limited } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl space-y-8 py-4 sm:py-10">
      <div className="space-y-3 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
          <Icon name="shield-check" className="size-7" strokeWidth={1.6} />
        </span>
        <h1 className="text-3xl font-semibold tracking-tight">Verify a credential</h1>
        <p className="mx-auto max-w-lg text-neutral-600">Paste the verification link you were given, or scan its QR code, to see exactly where a record stands today.</p>
      </div>
      <Card className="space-y-1 p-5 sm:p-6">
        <form action={lookupCredentialAction} className="space-y-4">
          <label htmlFor="reference" className="block text-sm font-medium text-neutral-800">
            Verification link or reference
          </label>
          <input id="reference" name="reference" type="text" required autoComplete="off" className={`${inputClass} py-2.5`} placeholder="https://… or 0x…" aria-describedby={invalid ? "ref-error" : undefined} />
          {limited ? <Alert tone="warning">Too many lookups from your connection. Wait a minute and try again.</Alert> : null}
          {invalid ? (
            <div id="ref-error">
              <Alert tone="error">That is not a valid verification link. Check it and try again.</Alert>
            </div>
          ) : null}
          <button type="submit" className={`${btn.primary} w-full sm:w-auto`}>
            <Icon name="search" className="size-4" />
            Check credential
          </button>
        </form>
      </Card>
      <p className="flex items-start justify-center gap-2 text-center text-sm text-neutral-500">
        <Icon name="lock" className="mt-0.5 size-4 shrink-0" />A record is only available here if its owner chose to share it. FARJI never lists people or records.
      </p>
    </div>
  );
}
