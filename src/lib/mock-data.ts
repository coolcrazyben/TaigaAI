import { subDays, format } from "date-fns";

export const demoStores = [
  { id: "demo-store-1", name: "Newton Junction", region: "Central" },
  { id: "demo-store-2", name: "Oak Street Fuel", region: "North" },
  { id: "demo-store-3", name: "Lakeside Market", region: "South" },
];

export const demoSummary = {
  kpis: {
    total_sales: 1845230,
    total_margin: 524820,
    margin_pct: 28.4,
    transaction_count: 304812,
    unit_count: 681295,
    negative_margin_skus: 39,
  },
  salesTrend: Array.from({ length: 21 }).map((_, index) => ({
    business_date: format(subDays(new Date(), 20 - index), "yyyy-MM-dd"),
    sales: 52000 + Math.round(Math.sin(index / 2) * 9000) + index * 850,
    margin: 14500 + Math.round(Math.cos(index / 2) * 2600) + index * 240,
  })),
  topProducts: [
    { sku: "CIG-NEW-SPL", product_name: "Newport Special", sales: 182340, margin: 40218, units: 47180 },
    { sku: "BEV-MON-16", product_name: "Monster Energy 16oz", sales: 106920, margin: 42140, units: 29110 },
    { sku: "FS-PIZ-SLC", product_name: "Pizza Slice", sales: 92440, margin: 52016, units: 23320 },
    { sku: "BEV-COKE-20", product_name: "Coca-Cola 20oz", sales: 77320, margin: 28012, units: 26040 },
  ],
  categoryPerformance: [
    { category_name: "Cigarettes", sales: 612500, margin: 129800, margin_pct: 21.2 },
    { category_name: "Packaged Beverage", sales: 392100, margin: 156920, margin_pct: 40.0 },
    { category_name: "Foodservice", sales: 284400, margin: 167110, margin_pct: 58.8 },
    { category_name: "Candy", sales: 126800, margin: 54380, margin_pct: 42.9 },
  ],
  storeComparison: [
    { store_name: "Newton Junction", sales: 702300, margin: 181420, margin_pct: 25.8 },
    { store_name: "Oak Street Fuel", sales: 581200, margin: 182040, margin_pct: 31.3 },
    { store_name: "Lakeside Market", sales: 561730, margin: 161360, margin_pct: 28.7 },
  ],
  negativeMarginSkus: [
    { sku: "TOB-PROMO-1", product_name: "Promotional Tobacco", sales: 8410, margin: -1180, margin_pct: -14.0 },
    { sku: "MILK-GAL", product_name: "Whole Milk Gallon", sales: 12110, margin: -410, margin_pct: -3.4 },
  ],
};
