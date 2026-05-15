import { z } from "zod";

const aliases: Record<string, string[]> = {
  store_name: ["store", "store name", "location", "site"],
  business_date: ["date", "business date", "transaction date", "sale date"],
  transaction_id: ["transaction id", "ticket", "receipt", "invoice"],
  sku: ["sku", "item", "item code", "plu", "upc"],
  product_name: ["description", "product", "product name", "item description"],
  brand: ["brand", "vendor brand"],
  category: ["category", "department", "major category"],
  quantity: ["qty", "quantity", "units"],
  unit_price: ["price", "unit price", "retail"],
  unit_cost: ["cost", "unit cost"],
  sales_amount: ["sales", "sales amount", "extended retail", "net sales"],
  cost_amount: ["cost amount", "extended cost"],
};

export const taigaRowSchema = z.object({
  store_name: z.string().min(1),
  business_date: z.string().min(8),
  transaction_id: z.string().optional().nullable(),
  sku: z.string().min(1),
  product_name: z.string().min(1),
  brand: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  quantity: z.coerce.number().finite(),
  unit_price: z.coerce.number().finite().optional().nullable(),
  unit_cost: z.coerce.number().finite().optional().nullable(),
  sales_amount: z.coerce.number().finite(),
  cost_amount: z.coerce.number().finite().optional().nullable(),
});

export type TaigaRow = z.infer<typeof taigaRowSchema>;

function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function mapTaigaRow(input: Record<string, unknown>) {
  const normalized = new Map<string, unknown>();

  for (const [key, value] of Object.entries(input)) {
    normalized.set(normalizeHeader(key), value);
  }

  const mapped: Record<string, unknown> = {};

  for (const [field, names] of Object.entries(aliases)) {
    const hit = names.find((name) => normalized.has(name));
    if (hit) mapped[field] = normalized.get(hit);
  }

  if (!mapped.sales_amount && mapped.quantity && mapped.unit_price) {
    mapped.sales_amount = Number(mapped.quantity) * Number(mapped.unit_price);
  }

  if (!mapped.cost_amount && mapped.quantity && mapped.unit_cost) {
    mapped.cost_amount = Number(mapped.quantity) * Number(mapped.unit_cost);
  }

  return taigaRowSchema.safeParse(mapped);
}

export function requiredTaigaColumns() {
  return Object.keys(aliases);
}
