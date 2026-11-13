/**
 * Capture the README screenshots against a running web app.
 *
 *   OPENREELS_API_KEY=... JOB_ID=... node scripts/capture-screenshots.mjs
 *
 * The app is expected on http://127.0.0.1:5199. Each page is captured at
 * 1440x900 at 2x so the images stay sharp on a retina display.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.SCREENSHOT_BASE ?? "http://127.0.0.1:5199";
const KEY = process.env.OPENREELS_API_KEY ?? process.env.KEY ?? "";
const JOB_ID = process.env.JOB_ID ?? "";
const OUT = ".github/assets/screens";
const STORAGE_KEY = "openreels.apiKey.v1";

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/repl/tools/bin/chromium",
  args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"],
});

async function settle(page, ms = 1200) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
}

// ── The lock screen is the one state that must be seen without a key ───────
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByText("Server key", { exact: false }).first().waitFor({ timeout: 30_000 });
  await settle(page);
  await page.screenshot({ path: `${OUT}/lock.png` });
  console.log("captured lock");
  await context.close();
}

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});
await context.addInitScript(
  ([key, storage]) => {
    if (key) window.localStorage.setItem(storage, key);
  },
  [KEY, STORAGE_KEY],
);

const page = await context.newPage();

async function capture(path, file, ready) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  // The sign-in gate has headings too; wait for it to actually go away.
  await page.waitForFunction(
    () => !document.body.innerText.includes("Private render bay"),
    null,
    { timeout: 30_000 },
  );
  await ready(page);
  await settle(page);
  await page.screenshot({ path: `${OUT}/${file}` });
  console.log(`captured ${file}`);
}

await capture("/", "home.png", async (p) => {
  await p.getByRole("heading").first().waitFor({ timeout: 30_000 });
});

await capture("/gallery", "gallery.png", async (p) => {
  await p.getByRole("heading").first().waitFor({ timeout: 30_000 });
  // The gallery is shared history; show the finished work, not old failures.
  const status = p.getByRole("combobox").filter({ hasText: "All statuses" });
  if (await status.count()) {
    await status.click();
    await p.getByText("Completed", { exact: true }).click();
    await p.waitForTimeout(600);
  }
});

if (JOB_ID) {
  await capture(`/jobs/${JOB_ID}`, "job.png", async (p) => {
    await p.getByRole("heading").first().waitFor({ timeout: 30_000 });
  });
}

await capture("/settings", "settings.png", async (p) => {
  await p.getByRole("heading").first().waitFor({ timeout: 30_000 });
});

await browser.close();
