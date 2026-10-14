"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Package, ShieldCheck, Truck } from "lucide-react";
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
import { ApiError } from "@/lib/api";
import { API_BASE_URL } from "@/lib/api";
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
      setError(
        cause instanceof ApiError
          ? `${cause.message}${cause.code ? ` (${cause.code})` : ""}`
          : cause instanceof Error
            ? cause.message
            : "Sign-in failed",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary-foreground text-primary">
            R
          </span>
          Routiq
        </div>
        <div className="space-y-6">
          <h1 className="text-3xl font-semibold leading-tight">
            Logistics &amp; delivery operations, in one console.
          </h1>
          <ul className="space-y-3 text-sm text-primary-foreground/80">
            <li className="flex items-center gap-2">
              <Package className="size-4" /> Book, confirm and track shipments
            </li>
            <li className="flex items-center gap-2">
              <Truck className="size-4" /> Dispatch the nearest driver automatically
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck className="size-4" />
              Signed proof of delivery and an audited timeline
            </li>
          </ul>
        </div>
        <p className="text-xs text-primary-foreground/70">
          API endpoint: {API_BASE_URL}
        </p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1 text-center lg:text-left">
            <div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground lg:hidden">
              <Truck className="size-5" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
            <p className="text-sm text-muted-foreground">
              Use a seeded demo account, or your own credentials.
            </p>
          </div>

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
              <Label htmlFor="password">Password</Label>
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

          <p className="text-center text-xs text-muted-foreground">
            API: <code>{API_BASE_URL}</code>
          </p>
        </div>
      </div>
    </div>
  );
}
