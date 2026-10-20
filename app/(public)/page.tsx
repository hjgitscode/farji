import Link from "next/link";
import { btn } from "@/components/ui";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 py-8">
      <section className="space-y-4">
        <h1 className="text-4xl font-semibold tracking-tight text-neutral-900">Credentials you can trust over time</h1>
        <p className="max-w-2xl text-lg text-neutral-700">
          FARJI shows professional experience, education and certifications that the institutions themselves have confirmed, and tells you whether each one is still current, expired, ended or withdrawn.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/signup" className={btn.primary}>
            Create your profile
          </Link>
          <Link href="/verify" className={btn.secondary}>
            Verify a credential
          </Link>
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-3" aria-label="How it works">
        {[
          ["Add your records", "Import your professional profile or add records yourself. They start out clearly marked as self-declared."],
          ["Institutions confirm", "The employer, university or licensing body checks its own records and confirms what is true."],
          ["Anyone can check", "Share a link or QR code. People see whether a record is current, historical, expired, ended or revoked."],
        ].map(([title, body]) => (
          <div key={title} className="rounded-xl border border-neutral-200 bg-white p-4">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-neutral-600">{body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
