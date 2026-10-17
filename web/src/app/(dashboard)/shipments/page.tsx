"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { EmptyState, ErrorState, PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatMoney } from "@/lib/format";
import { roleHasPermission } from "@/lib/permissions";
import { useSession } from "@/lib/session";
import type { Customer, Shipment, ShipmentStatus } from "@/lib/types";
import { useApiQuery } from "@/lib/use-api-query";

const STATUSES: ShipmentStatus[] = [
  "CREATED",
  "CONFIRMED",
  "ASSIGNED",
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED_ATTEMPT",
  "RETURNED",
  "CANCELLED",
];

interface ShipmentsData {
  shipments: Shipment[];
  customers: Map<string, Customer>;
}

export default function ShipmentsPage() {
  const [filter, setFilter] = useState<string>("ALL");
  const { session } = useSession();
  const canCreate = roleHasPermission(session?.tenant?.role, "shipments:create");

  const { data, loading, error, reload } = useApiQuery<ShipmentsData>(
    async (api) => {
      const [shipments, customers] = await Promise.all([
        api.get<{ data: Shipment[] }>("/shipments"),
        api.get<{ data: Customer[] }>("/customers").catch(() => ({ data: [] })),
      ]);
      return {
        shipments: shipments.data,
        customers: new Map(customers.data.map((c) => [c.id, c])),
      };
    },
    [],
  );

  const shipments = data?.shipments ?? [];
  const customers = data?.customers ?? new Map<string, Customer>();
  const visible =
    filter === "ALL"
      ? shipments
      : shipments.filter((s) => s.status === (filter as ShipmentStatus));

  return (
    <>
      <PageHeader
        title="Shipments"
        description="Every shipment visible to your role, newest first."
        action={
          <div className="flex items-center gap-2">
            {canCreate ? (
              <Link
                href="/shipments/new"
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus className="size-4" />
                New shipment
              </Link>
            ) : null}
            <Button variant="outline" onClick={() => void reload()}>
              <RefreshCw className="size-4" />
              Refresh
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <Select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="w-48"
          aria-label="Filter by status"
        >
          <option value="ALL">All statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
        <span className="text-sm text-muted-foreground">
          {visible.length} shown
        </span>
      </div>

      {error ? <ErrorState message={error} /> : null}

      {loading && shipments.length === 0 ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : null}

      {!error && !loading && visible.length === 0 ? (
        <EmptyState message="No shipments match this filter." />
      ) : null}

      {!error && visible.length > 0 ? (
        <Card>
          <CardContent className="px-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tracking</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Weight</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((shipment) => (
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
                      {customers.get(shipment.customerId)?.name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={shipment.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {shipment.weightKg} kg
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMoney(shipment.priceMinor, shipment.currency)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(shipment.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
