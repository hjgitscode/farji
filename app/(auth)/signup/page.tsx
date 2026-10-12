import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth/AuthForm";
import { signupAction } from "@/lib/auth/actions";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Create a candidate account</h1>
      <p className="max-w-md text-sm text-neutral-700">
        This creates a candidate account. Organisation reviewers are invited by an administrator.
      </p>
      <AuthForm action={signupAction} submitLabel="Create account" passwordAutoComplete="new-password" />
      <p className="text-sm text-neutral-700">
        Already have an account?{" "}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </p>
    </section>
  );
}
