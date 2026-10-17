"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function AuthFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const { api } = useSession();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.resetPassword(token, password);
      setDone(true);
      setTimeout(() => router.replace("/login"), 1500);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Your reset link is valid for one hour."
    >
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not reset your password</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!token ? (
        <Alert variant="destructive">
          <AlertTitle>Missing reset token</AlertTitle>
          <AlertDescription>
            This link is incomplete. Request a new one from the sign-in screen.
          </AlertDescription>
        </Alert>
      ) : done ? (
        <Alert>
          <AlertTitle>Password updated</AlertTitle>
          <AlertDescription>Taking you to the sign-in screen…</AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Update password
          </Button>
        </form>
      )}

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
