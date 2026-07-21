import { chromium } from "playwright";
const URL = "http://localhost:5173";
const OUT = process.argv[2] || "/tmp/tm_pos.png";
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

// Arm the long-position tool, then place entry / SL / TP / right-edge.
await page.click('button[title="Long position"]');
await page.waitForTimeout(500);
const clicks = [
  [720, 470], // entry
  [720, 560], // SL (below entry = lower price)
  [720, 300], // TP (above entry = higher price)
  [1120, 470], // right-edge extent
];
for (const [x, y] of clicks) {
  await page.mouse.move(x, y);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(650);
}
// Click empty space to finalise/deselect so the finished tool renders.
await page.mouse.move(400, 800);
await page.waitForTimeout(200);
await page.mouse.click(400, 800);
await page.waitForTimeout(600);
await page.screenshot({ path: OUT });
// Zoom crop around the tool for a closer look.
await page.screenshot({ path: OUT.replace(".png", "_crop.png"), clip: { x: 600, y: 250, width: 700, height: 400 } });
console.log("SAVED", OUT);
await browser.close();
