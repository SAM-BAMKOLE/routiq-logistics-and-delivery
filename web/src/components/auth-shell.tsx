"use client";

import { Package, ShieldCheck, Truck } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";

/**
 * The split-screen frame shared by every unauthenticated page (sign in, sign
 * up, invite acceptance, password reset). Keeping it in one place means the
 * marketing panel and the form column stay identical across the flows.
 */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
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
            <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
            {subtitle ? (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
