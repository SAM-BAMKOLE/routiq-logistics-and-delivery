"use client";

import Link from "next/link";
import { Loader2, Package, Truck, Users, Wallet } from "lucide-react";
import { EmptyState, ErrorState, PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useSession } from "@/lib/session";
import type {
  Customer,
  Driver,
  PricingRule,
  Shipment,
} from "@/lib/types";
import { useApiQuery } from "@/lib/use-api-query";

const ACTIVE_STATUSES = new Set([
  "ASSIGNED",
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
]);

interface Overview {
  shipments: Shipment[];
  drivers: Driver[];
  customers: Customer[];
  rules: PricingRule[];
}

export default function DashboardPage() {
  const { session } = useSession();
  const { data, loading, error, reload } = useApiQuery<Overview>(async (api) => {
    const [shipments, drivers, customers, rules] = await Promise.all([
      api.get<{ data: Shipment[] }>("/shipments"),
      api.get<{ data: Driver[] }>("/drivers").catch(() => ({ data: [] })),
      api.get<{ data: Customer[] }>("/customers").catch(() => ({ data: [] })),
      api.get<{ data: PricingRule[] }>("/pricing-rules").catch(() => ({ data: [] })),
    ]);
    return {
      shipments: shipments.data,
      drivers: drivers.data,
      customers: customers.data,
      rules: rules.data,
    };
  });

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Overview" />
        <ErrorState message={error} />
        <Button className="mt-4" variant="outline" onClick={reload}>
          Retry
        </Button>
      </>
    );
  }

  const shipments = data?.shipments ?? [];
  const active = shipments.filter((s) => ACTIVE_STATUSES.has(s.status)).length;
  const delivered = shipments.filter((s) => s.status === "DELIVERED").length;
  const availableDrivers = (data?.drivers ?? []).filter(
    (d) => d.availability === "available" && d.status === "active",
  ).length;
  const revenue = shipments
    .filter((s) => s.status === "DELIVERED")
    .reduce((sum, s) => sum + (s.priceMinor ?? 0), 0);

  const recent = [...shipments]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 8);

  return (
    <>
      <PageHeader
        title={`Welcome back${session?.user.name ? `, ${session.user.name.split(" ")[0]}` : ""}`}
        description={`${session?.tenant?.name ?? "Tenant"} · live snapshot of your operation`}
        action={
          <Button variant="outline" onClick={reload} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Shipments"
          value={shipments.length}
          hint={`${active} active`}
          icon={<Package className="size-4" />}
        />
        <StatCard
          label="Delivered"
          value={delivered}
          hint={formatMoney(revenue)}
          icon={<Wallet className="size-4" />}
        />
        <StatCard
          label="Drivers on shift"
          value={availableDrivers}
          hint={`${data?.drivers.length ?? 0} total`}
          icon={<Truck className="size-4" />}
        />
        <StatCard
          label="Customers"
          value={data?.customers.length ?? 0}
          hint={`${data?.rules.length ?? 0} rate cards`}
          icon={<Users className="size-4" />}
        />
      </div>

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent shipments</CardTitle>
          <Link
            href="/shipments"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            View all
          </Link>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {recent.length === 0 ? (
            <div className="px-6 pb-6">
              <EmptyState message="No shipments yet. They will appear here once the bots or your team book one." />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tracking</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Weight</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((shipment) => (
                  <TableRow key={shipment.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/shipments/${shipment.id}`}
                        className="hover:underline"
                      >
                        {shipment.trackingNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={shipment.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {shipment.weightKg} kg
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(shipment.priceMinor, shipment.currency)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(shipment.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
          {hint ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}
