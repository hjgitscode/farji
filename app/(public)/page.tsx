import Link from "next/link";

export default function HomePage() {
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight">Credentials you can trust over time</h1>
      <p className="max-w-2xl text-neutral-700">
        FARJI helps professionals present verified experience, education and certifications, and
        lets anyone check them.
      </p>
      <p>
        <Link href="/verify" className="underline">
          Verify a credential
        </Link>
      </p>
    </section>
  );
}
