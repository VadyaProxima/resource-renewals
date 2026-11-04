import { z } from "zod";
import type { Renewal } from "@renewals/contracts";
const resultSchema = z.object({
  operation_id: z.uuid(),
  status: z.literal("completed"),
  started_count: z.literal(1),
  resource_id: z.string(),
  period_months: z.literal(1),
  amount_minor: z.number().int(),
  currency: z.literal("RUB"),
});
export type ProviderResult = z.infer<typeof resultSchema>;
export interface Provider {
  lookup(row: Renewal): Promise<ProviderResult | null>;
  send(row: Renewal): Promise<ProviderResult | null>;
}
export class ProviderClient implements Provider {
  constructor(
    private url: string,
    private timeout: number,
  ) {}
  private validate(value: unknown, row: Renewal) {
    const parsed = resultSchema.safeParse(value);
    if (!parsed.success) return null;
    const data = parsed.data;
    return data.resource_id === row.resource_id &&
      data.amount_minor === row.amount_minor &&
      data.currency === row.currency
      ? data
      : null;
  }
  async lookup(row: Renewal) {
    try {
      const response = await fetch(
        `${this.url}/renewals/${encodeURIComponent(row.operation_key)}`,
        { signal: AbortSignal.timeout(this.timeout) },
      );
      return response.ok ? this.validate(await response.json(), row) : null;
    } catch {
      return null;
    }
  }
  async send(row: Renewal) {
    try {
      const response = await fetch(`${this.url}/renewals`, {
        method: "POST",
        signal: AbortSignal.timeout(this.timeout),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": row.operation_key,
        },
        body: JSON.stringify({
          resource_id: row.resource_id,
          period_months: 1,
          amount_minor: row.amount_minor,
          currency: row.currency,
        }),
      });
      return response.ok ? this.validate(await response.json(), row) : null;
    } catch {
      return null;
    }
  }
}
