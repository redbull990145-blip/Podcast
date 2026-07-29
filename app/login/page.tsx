import Link from "next/link";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { Wordmark } from "@/components/brand/logo";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <main className="grid min-h-dvh place-items-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 inline-block">
          <Wordmark />
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Your subscriptions, queue and playback position, on every device.
        </p>

        {error && (
          <p className="mt-4 rounded-[var(--radius-app)] border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error === "oauth"
              ? "Couldn't start Google sign-in. Try email instead."
              : "Something went wrong signing you in. Please try again."}
          </p>
        )}

        <AuthForm mode="signin" next={next} />

        <p className="mt-6 text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link href="/signup" className="font-medium text-accent hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
