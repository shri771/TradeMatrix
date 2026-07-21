import { chromium } from "playwright";
const URL = "http://localhost:5173";
const OUT = process.argv[2] || "/tmp/tm_trend.png";
const pane = { source: "hyperliquid", symbol: "BTC", interval: "5m", indicators: [], htfs: [] };

const browser = await chromium.launch({ executablePath: "/run/current-system/sw/bin/brave", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.addInitScript((p) => {
  localStorage.setItem("tm:chartCount", "1");
  localStorage.setItem("tm:panes", JSON.stringify([p]));
}, pane);

const c5 = (r) => r.url().includes("/api/candles") && r.url().includes("interval=5m") && r.status() === 200;
const load = page.waitForResponse(c5, { timeout: 60000 }).catch(() => {});
await page.goto(URL, { waitUntil: "domcontentloaded" });
await load;
await page.waitForTimeout(2500);

// Open the ✎ drawing menu, pick Trend line.
await page.click('button[title="Drawing tools"]');
await page.waitForTimeout(300);
await page.getByText("Trend line", { exact: true }).click();
await page.waitForTimeout(400);

// Two points forming a clearly SLOPED line (lower-left -> upper-right).
const pts = [
  [640, 640],
  [1160, 340],
];
for (const [x, y] of pts) {
  await page.mouse.move(x, y);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(650);
}
// Deselect
await page.mouse.click(300, 800);
await page.waitForTimeout(600);

await page.screenshot({ path: OUT });
await page.screenshot({ path: OUT.replace(".png", "_crop.png"), clip: { x: 560, y: 300, width: 720, height: 400 } });
console.log("SAVED", OUT);
await browser.close();
