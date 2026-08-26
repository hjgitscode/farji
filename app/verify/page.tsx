import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { VerifyLookupForm } from "@/app/verify/VerifyLookupForm";
import { getAllCredentials } from "@/lib/services/candidateService";

export default function VerifyLandingPage() {
  const demoCredentials = getAllCredentials().filter((c) => c.candidateId === "CAND-001");

  return (
    <div>
      <PageHeader
        title="Verify a Credential"
        subtitle="No login, no wallet, no cryptocurrency knowledge required."
      />
      <Card className="max-w-lg">
        <VerifyLookupForm />
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Demo credentials
        </p>
        <ul className="mt-2 space-y-1 text-sm">
          {demoCredentials.map((c) => (
            <li key={c.credentialId}>
              <Link href={`/verify/${c.credentialId}`} className="text-brand hover:underline">
                {c.credentialId} — {c.title}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
