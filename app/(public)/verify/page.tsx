import type { Metadata } from "next";
import { Alert, btn, Card, inputClass, PageHeader } from "@/components/ui";
import { lookupCredentialAction } from "./actions";

export const metadata: Metadata = { title: "Verify a credential" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ invalid?: string }> }) {
  const { invalid } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Verify a credential" description="Paste the verification link you were given, or scan its QR code, to see exactly where a record stands today." />
      <Card>
        <form action={lookupCredentialAction} className="space-y-3">
          <label htmlFor="reference" className="block text-sm font-medium">
            Verification link or reference
          </label>
          <input id="reference" name="reference" type="text" required autoComplete="off" className={inputClass} placeholder="https://… or 0x…" aria-describedby={invalid ? "ref-error" : undefined} />
          {invalid ? (
            <div id="ref-error">
              <Alert tone="error">That is not a valid verification link. Check it and try again.</Alert>
            </div>
          ) : null}
          <button type="submit" className={btn.primary}>
            Check credential
          </button>
        </form>
      </Card>
      <p className="text-sm text-neutral-600">A record is only available here if its owner chose to share it. FARJI never lists people or records.</p>
    </div>
  );
}
