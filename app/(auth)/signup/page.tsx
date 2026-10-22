import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { AuthForm } from "@/components/auth/AuthForm";
import { signupAction } from "@/lib/auth/actions";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <AuthCard
      title="Create your profile"
      icon="user"
      description="Start a candidate account to build your professional record and ask institutions to confirm it. Organisation reviewers are invited by an administrator."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-emerald-800 underline decoration-emerald-300 underline-offset-4 hover:text-emerald-900">
            Sign in
          </Link>
        </>
      }
    >
      <AuthForm action={signupAction} submitLabel="Create account" passwordAutoComplete="new-password" />
    </AuthCard>
  );
}
