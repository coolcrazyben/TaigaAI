import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", override: true, quiet: true });
dotenv.config({ path: ".env", quiet: true });

const {
  TAIGA_LOGIN_URL,
  TAIGA_REPORT_URL,
  TAIGA_USERNAME,
  TAIGA_PASSWORD,
  TAIGA_USERNAME_SELECTOR = 'input[type="email"], input[name="username"], input[name="email"]',
  TAIGA_PASSWORD_SELECTOR = 'input[type="password"], input[name="password"]',
  TAIGA_SUBMIT_SELECTOR = 'button[type="submit"], input[type="submit"]',
  TAIGA_STORAGE_STATE = "data/taiga-storage-state.json",
  TAIGA_DISCOVERY_OUTPUT = "data/taiga-network-discovery.json",
} = process.env;

if (!TAIGA_LOGIN_URL && !TAIGA_REPORT_URL) {
  throw new Error("Set TAIGA_LOGIN_URL in .env.local. TAIGA_REPORT_URL is optional if you navigate manually.");
}

if (TAIGA_LOGIN_URL?.includes("your-taiga-login-page") || TAIGA_REPORT_URL?.includes("your-taiga")) {
  throw new Error("Replace TAIGA_LOGIN_URL and any TAIGA_REPORT_URL placeholder in .env.local before running discovery.");
}

await fs.mkdir(path.dirname(TAIGA_STORAGE_STATE), { recursive: true });
await fs.mkdir(path.dirname(TAIGA_DISCOVERY_OUTPUT), { recursive: true });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  storageState: await exists(TAIGA_STORAGE_STATE) ? TAIGA_STORAGE_STATE : undefined,
  acceptDownloads: true,
});
const page = await context.newPage();

const calls = [];

async function saveDiscovery() {
  await context.storageState({ path: TAIGA_STORAGE_STATE });
  await fs.writeFile(TAIGA_DISCOVERY_OUTPUT, JSON.stringify(calls, null, 2));
  console.log(`Saved ${calls.length} network calls to ${TAIGA_DISCOVERY_OUTPUT}`);
}

page.on("response", async (response) => {
  const request = response.request();
  const resourceType = request.resourceType();
  const url = response.url();
  const contentType = response.headers()["content-type"] ?? "";

  if (!["xhr", "fetch"].includes(resourceType) && !contentType.includes("json") && !contentType.includes("csv")) {
    return;
  }

  const record = {
    method: request.method(),
    url,
    status: response.status(),
    resourceType,
    contentType,
    postData: request.postData(),
    sample: "",
  };

  try {
    if (contentType.includes("json") || contentType.includes("csv") || contentType.includes("text")) {
      record.sample = (await response.text()).slice(0, 1500);
    }
  } catch {
    record.sample = "[body unavailable]";
  }

  calls.push(record);
  console.log(`${record.status} ${record.method} ${url}`);
});

if (TAIGA_LOGIN_URL && TAIGA_USERNAME && TAIGA_PASSWORD) {
  await page.goto(TAIGA_LOGIN_URL, { waitUntil: "domcontentloaded" });
  const usernameInput = page.locator(TAIGA_USERNAME_SELECTOR).first();
  const hasLoginForm = await usernameInput.isVisible({ timeout: 5000 }).catch(() => false);

  if (hasLoginForm) {
    await usernameInput.fill(TAIGA_USERNAME);
    await page.locator(TAIGA_PASSWORD_SELECTOR).first().fill(TAIGA_PASSWORD);
    await Promise.all([
      page.waitForLoadState("networkidle").catch(() => {}),
      page.locator(TAIGA_SUBMIT_SELECTOR).first().click(),
    ]);
  } else {
    console.log("Login form was not visible; assuming the browser session is already authenticated.");
    await page.waitForLoadState("networkidle").catch(() => {});
  }

  await context.storageState({ path: TAIGA_STORAGE_STATE });
}

try {
  await page.goto(TAIGA_REPORT_URL || TAIGA_LOGIN_URL, { waitUntil: "networkidle" });
  console.log("Navigate to Store Performance, interact with filters/tabs/date ranges, then press Enter here to save discovered calls.");
  await waitForEnter();
} finally {
  await saveDiscovery();
  await browser.close();
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function waitForEnter() {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });
}
