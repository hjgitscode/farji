import type { Metadata } from "next";

export const metadata: Metadata = { title: "Verify a credential" };

export default function VerifyPage() {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Verify a credential</h1>
      <p className="text-neutral-700">Credential verification is not available yet.</p>
    </section>
  );
}
