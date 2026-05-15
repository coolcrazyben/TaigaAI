import { chromium } from 'playwright';
import dotenv from 'dotenv';
dotenv.config({ path: 'G:/TaigaAI/.env.local', override: true });

const EMAIL = process.env.TAIGA_EMAIL || process.env.TAIGA_USERNAME;
const PASSWORD = process.env.TAIGA_PASSWORD;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

let token = '';
context.on('response', async (res) => {
  if (res.url().includes('/app-api/auth') && res.request().method() === 'GET') {
    const b = await res.json().catch(() => ({}));
    if (b?.token) token = b.token;
  }
});

await page.goto('https://app.taigadata.com/login');
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type="submit"]');
await new Promise(r => setTimeout(r, 4000));
await browser.close();

const headers = { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + token };
const filter = {
  Time_Filter: { dimension: 'LASTMONTH', timeZoneOffsetMinutes: 300, daysOfWeek: '', start: '', end: '', selectedComparison: '', sameStoreSales: false },
  Query_Filter: [
    { Field: 'StoreName', Value: null },
    { Field: 'Tags', Value: null, RequireAll: true },
    { Field: 'TagGroups', Value: null, RequireAll: true },
    { Field: 'SourceType', Value: null },
    { Field: 'TransactionType', Value: 'sql::1=1', Exclude: false, RequireAll: false },
  ],
  Filter_Options: { ConsoleWidgetDisplayOptions: [], ReportHiddenColumns: [], HiddenFilters: [], HiddenByDefault: [], IsDefault: false },
};

// Full column list from scraper — minus TagGroup
const columns = [
  { Field: 'StoreId',         Label: 'StoreId',         Function: true, FunctionType: 'GroupByRequired' },
  { Field: 'StoreName',       Label: 'StoreName',       Function: true, FunctionType: 'GroupByRequired' },
  { Field: 'StoreIdentifier', Label: 'StoreIdentifier', Function: true, FunctionType: 'GroupByRequired' },
  { Field: 'sum([TotalTransactions])',   Label: 'TotalTransactions',   Function: true },
  { Field: 'sum([GrossAmount])',         Label: 'GrossAmount',         Function: true },
  { Field: 'sum([NetAmount])',           Label: 'NetAmount',           Function: true },
  { Field: 'sum([AdjustedSalesTotal])', Label: 'AdjustedSalesTotal',  Function: true },
  { Field: 'sum([GallonsPumped])',       Label: 'GallonsPumped',       Function: true },
  { Field: 'sum([FuelSales])',           Label: 'FuelSales',           Function: true },
  { Field: 'sum([TotalItemCost])',       Label: 'TotalItemCost',       Function: true },
  { Field: 'sum([TotalItemRetail])',     Label: 'TotalItemRetail',     Function: true },
  { Field: 'sum([TotalFuelTransactions])',  Label: 'TotalFuelTransactions',  Function: true },
  { Field: 'sum([TotalInstoreTransactions])', Label: 'TotalInstoreTransactions', Function: true },
  { Field: 'sum([TotalOutsideTransactions])', Label: 'TotalOutsideTransactions', Function: true },
];

const payload = [{
  id: 'GridResult',
  operation: 'table-results',
  parameters: [
    { key: 'DataViewId', value: 113 },
    { key: 'Body', value: JSON.stringify({
      WidgetId: 269, Columns: columns, FilterBy: '', GroupBy: 'StoreName, StoreId, StoreIdentifier',
      OverrideQueryView: '', OrderBy: '', Limit: 0,
      Filter: filter, StaticTimeDimension: '',
    }) },
    { key: 'Filter', value: JSON.stringify(filter) },
  ],
}];

const res = await fetch('https://api.taigadata.com/app-api/data-view-batch', {
  method: 'POST', headers, body: JSON.stringify(payload),
});
const json = await res.json();
console.log('STATUS:', res.status);
if (json[0]?.exception) {
  console.log('EXCEPTION:', json[0].exception.slice(0, 600));
} else {
  console.log('ROWS:', json[0]?.value?.length);
  console.log('SAMPLE:', JSON.stringify(json[0]?.value?.[0], null, 2));
}
