"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { EmptyState, ErrorState, PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Driver, Vehicle } from "@/lib/types";
import { useApiQuery } from "@/lib/use-api-query";

export default function DriversPage() {
  const { data, loading, error, reload } = useApiQuery<{
    drivers: Driver[];
    vehicles: Map<string, Vehicle>;
  }>(async (api) => {
    const [drivers, vehicles] = await Promise.all([
      api.get<{ data: Driver[] }>("/drivers"),
      api.get<{ data: Vehicle[] }>("/vehicles").catch(() => ({ data: [] })),
    ]);
    return {
      drivers: drivers.data,
      vehicles: new Map(vehicles.data.map((v) => [v.id, v])),
    };
  });

  const drivers = data?.drivers ?? [];
  const vehicles = data?.vehicles ?? new Map<string, Vehicle>();

  const available = drivers.filter((d) => d.availability === "available").length;

  return (
    <>
      <PageHeader
        title="Drivers"
        description={
          drivers.length > 0
            ? `${drivers.length} driver profiles · ${available} available`
            : undefined
        }
        action={
          <Button variant="outline" onClick={() => void reload()}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
      />

      {error ? <ErrorState message={error} /> : null}

      {loading && drivers.length === 0 ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : null}

      {!error && !loading && drivers.length === 0 ? (
        <EmptyState message="No drivers yet. Seed the demo data or invite your drivers." />
      ) : null}

      {drivers.length > 0 ? (
        <Card>
          <CardContent className="px-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Driver</TableHead>
                  <TableHead>Licence</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Availability</TableHead>
                  <TableHead>Vehicle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drivers.map((driver) => {
                  const vehicle = driver.currentVehicleId
                    ? vehicles.get(driver.currentVehicleId)
                    : undefined;
                  return (
                    <TableRow key={driver.id}>
                      <TableCell className="font-mono text-xs">
                        {driver.id.slice(0, 8)}
                      </TableCell>
                      <TableCell>{driver.licenseNo}</TableCell>
                      <TableCell>
                        <StatusBadge status={driver.status} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={driver.availability} />
                      </TableCell>
                      <TableCell>
                        {vehicle
                          ? `${vehicle.plate} · ${vehicle.type}`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
