"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { EmptyState, ErrorState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import type { PricingRule } from "@/lib/types";
import { useApiQuery } from "@/lib/use-api-query";

export default function PricingPage() {
  const { data, loading, error, reload } = useApiQuery<PricingRule[]>(
    async (api) => (await api.get<{ data: PricingRule[] }>("/pricing-rules")).data,
  );

  const rules = data ?? [];

  return (
    <>
      <PageHeader
        title="Pricing"
        description="Tenant rate cards. The quote engine evaluates rules by priority and only applies ones whose start date has passed."
        action={
          <Button variant="outline" onClick={() => void reload()}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
      />

      <Card className="mb-4 max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">How a quote is priced</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Total</span> = base fee
            + (distance × per-km) + (weight × per-kg), floored at the minimum
            fee. Distance is the straight-line Haversine distance when both
            addresses have coordinates.
          </p>
        </CardContent>
      </Card>

      {error ? <ErrorState message={error} /> : null}

      {loading && rules.length === 0 ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : null}

      {!error && !loading && rules.length === 0 ? (
        <EmptyState message="No rate cards configured for this tenant." />
      ) : null}

      {rules.length > 0 ? (
        <Card>
          <CardContent className="px-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">Per km</TableHead>
                  <TableHead className="text-right">Per kg</TableHead>
                  <TableHead className="text-right">Minimum</TableHead>
                  <TableHead className="text-right">Priority</TableHead>
                  <TableHead>Active from</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{rule.name}</TableCell>
                    <TableCell className="text-right">
                      {formatMoney(rule.baseFeeMinor)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMoney(rule.perKmMinor)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMoney(rule.perKgMinor)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMoney(rule.minFeeMinor)}
                    </TableCell>
                    <TableCell className="text-right">
                      {rule.priority}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(rule.activeFrom)}
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
