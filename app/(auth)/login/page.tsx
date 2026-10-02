import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="text-neutral-700">Sign-in is not available yet.</p>
    </section>
  );
}
