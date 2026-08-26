import Link from "next/link";
import { Card } from "@/components/ui/Card";

const ctas = [
  {
    href: "/verify",
    title: "Verify a Credential",
    description: "The public, no-login recruiter view of a candidate's claim.",
  },
  {
    href: "/candidate",
    title: "Candidate Demo",
    description: "See a candidate's claims, their lifecycle types, and current states.",
  },
  {
    href: "/issuer",
    title: "Issuer Demo",
    description: "Approve claims, create CohortProof and ProofPulse batches, revoke a credential.",
  },
  {
    href: "/technology",
    title: "About the Technology",
    description: "The architecture, from the app layer down to the smart contract.",
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-col gap-12">
      <section className="text-center">
        <h1 className="text-4xl font-bold text-slate-900 sm:text-5xl">NotSoFarji</h1>
        <p className="mt-3 text-lg text-slate-600">Because your resume should not be farji.</p>
        <p className="mx-auto mt-4 max-w-2xl text-slate-500">
          A lifecycle-aware blockchain verification system for professional claims — built as a
          university Innovative Design Project.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ctas.map((cta) => (
          <Link key={cta.href} href={cta.href}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <h2 className="text-lg font-semibold text-slate-900">{cta.title}</h2>
              <p className="mt-1 text-sm text-slate-500">{cta.description}</p>
            </Card>
          </Link>
        ))}
      </section>

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
        <p>
          Most blockchain credential systems answer &ldquo;was this credential valid when it was
          issued?&rdquo; NotSoFarji asks whether verification can evolve into a{" "}
          <strong>lifecycle-aware proof of professional state over time</strong> — see the{" "}
          <Link href="/novelty" className="text-brand hover:underline">
            Novelty
          </Link>{" "}
          page for what is established cryptography versus this project&apos;s own design
          contributions.
        </p>
      </section>
    </div>
  );
}
