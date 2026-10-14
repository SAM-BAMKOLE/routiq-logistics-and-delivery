"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  LogOut,
  MapPin,
  Package,
  ReceiptText,
  Truck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/shipments", label: "Shipments", icon: Package },
  { href: "/drivers", label: "Drivers", icon: Truck },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/tracking", label: "Tracking", icon: MapPin },
  { href: "/pricing", label: "Pricing", icon: ReceiptText },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session, logout } = useSession();

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-background lg:flex">
        <div className="flex h-16 items-center gap-2 border-b px-6">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            R
          </div>
          <span className="text-base font-semibold tracking-tight">Routiq</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {NAV.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-4 border-b bg-background px-4 lg:px-6">
          <div className="flex items-center gap-2 lg:hidden">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
              R
            </div>
            <span className="font-semibold">Routiq</span>
          </div>
          <div className="hidden min-w-0 flex-col lg:flex">
            <span className="truncate text-sm font-medium">
              {session?.tenant?.name ?? "No active tenant"}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {session?.user.email}
              {session?.tenant?.role ? ` · ${session.tenant.role}` : ""}
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            <LogOut className="size-4" />
            Sign out
          </Button>
        </header>
        <main className="flex-1 overflow-x-hidden px-4 py-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
