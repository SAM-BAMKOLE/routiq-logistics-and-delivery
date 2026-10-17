"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";

const DEMO_PASSWORD = "Passw0rd!demo";

const DEMO_ACCOUNTS = [
  { label: "Acme Logistics", email: "admin@acme-logistics.demo", role: "tenant admin" },
  { label: "Bamko Couriers", email: "admin@bamko-couriers.demo", role: "tenant admin" },
  { label: "Acme dispatcher", email: "dispatch@acme-logistics.demo", role: "dispatcher" },
  { label: "Acme driver", email: "driver1@acme-logistics.demo", role: "driver" },
];

export default function LoginPage() {
  const router = useRouter();
  const { login, session, ready } = useSession();
  const [email, setEmail] = useState("admin@acme-logistics.demo");
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (ready && session) router.replace("/dashboard");
  }, [ready, session, router]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
      router.replace("/dashboard");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Use a seeded demo account, or your own credentials."
    >
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not sign in</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Sign in
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        New to Routiq?{" "}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Create a company
        </Link>
      </p>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="size-4" />
            Demo accounts
          </CardTitle>
          <CardDescription>
            Seeded by <code>pnpm db:seed:demo</code>. Password:{" "}
            <code>{DEMO_PASSWORD}</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              onClick={() => {
                setEmail(account.email);
                setPassword(DEMO_PASSWORD);
              }}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            >
              <span className="font-medium">{account.label}</span>
              <span className="text-xs text-muted-foreground">
                {account.role}
              </span>
            </button>
          ))}
        </CardContent>
      </Card>
    </AuthShell>
  );
}
