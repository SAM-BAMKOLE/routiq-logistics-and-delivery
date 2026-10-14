"use client";

import { useState } from "react";
import { ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { EmptyState, ErrorState, PageHeader } from "@/components/page-header";
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
import type { Address, Customer } from "@/lib/types";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { useApiQuery } from "@/lib/use-api-query";

export default function CustomersPage() {
  const { data, loading, error, reload } = useApiQuery<Customer[]>(
    async (api) => (await api.get<{ data: Customer[] }>("/customers")).data,
  );

  const customers = data ?? [];

  return (
    <>
      <PageHeader
        title="Customers"
        description={
          customers.length > 0 ? `${customers.length} customers` : undefined
        }
        action={
          <Button variant="outline" onClick={() => void reload()}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
      />

      {error ? <ErrorState message={error} /> : null}

      {loading && customers.length === 0 ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : null}

      {!error && !loading && customers.length === 0 ? (
        <EmptyState message="No customers yet. Seed the demo data to get started." />
      ) : null}

      {customers.length > 0 ? (
        <Card>
          <CardContent className="px-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => (
                  <CustomerRow key={customer.id} customer={customer} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

function CustomerRow({ customer }: { customer: Customer }) {
  const { api } = useSession();
  const [open, setOpen] = useState(false);
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle(): Promise<void> {
    const next = !open;
    setOpen(next);
    if (next && addresses === null) {
      setLoading(true);
      try {
        const result = await api.get<{ data: Address[] }>(
          `/customers/${customer.id}/addresses`,
        );
        setAddresses(result.data);
      } catch {
        setAddresses([]);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <>
      <TableRow>
        <TableCell>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Toggle addresses"
            onClick={() => void toggle()}
          >
            <ChevronRight
              className={cn("size-4 transition-transform", open && "rotate-90")}
            />
          </Button>
        </TableCell>
        <TableCell className="font-medium">{customer.name}</TableCell>
        <TableCell className="text-muted-foreground">
          {customer.email ?? "—"}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {customer.phone ?? "—"}
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow>
          <TableCell colSpan={4} className="bg-muted/40">
            {loading ? (
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Loading addresses…
              </span>
            ) : (addresses ?? []).length === 0 ? (
              <span className="text-sm text-muted-foreground">
                No saved addresses.
              </span>
            ) : (
              <ul className="space-y-1 text-sm">
                {(addresses ?? []).map((address) => (
                  <li key={address.id}>
                    {address.line1}, {address.city}
                    {address.region ? `, ${address.region}` : ""} ·{" "}
                    {address.country}
                  </li>
                ))}
              </ul>
            )}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
