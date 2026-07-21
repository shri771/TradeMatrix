import { chromium } from "playwright";
const URL = "http://localhost:5173";
const OUT = process.argv[2] || "/tmp/tm_marker.png";

// A BTC pane (price ~64000) with a persisted paper trade at price 12 on BTC.
// If klinecharts folds the trade-marker overlay's point into the y-axis
// auto-range, the axis will crush toward ~12 and the candles vanish upward —
// reproducing the reported "axis at 10-15 while price is way up" bug.
const pane = { source: "hyperliquid", symbol: "BTC", interval: "5m", indicators: [], htfs: [] };
const account = {
  cash: 100000,
  positions: {},
  realized: 0,
  trades: [{ id: "seed-1", symbol: "BTC", side: "buy", qty: 1, price: 12, time: 1784400000 }],
};

const browser = await chromium.launch({ executablePath: "/run/current-system/sw/bin/brave", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.addInitScript((d) => {
  localStorage.setItem("tm:chartCount", "1");
  localStorage.setItem("tm:panes", JSON.stringify([d.pane]));
  localStorage.setItem("tm:account", JSON.stringify(d.account));
}, { pane, account });

const cc = (r) => r.url().includes("/api/candles") && r.url().includes("interval=5m") && r.status() === 200;
const load = page.waitForResponse(cc, { timeout: 60000 }).catch(() => {});
await page.goto(URL, { waitUntil: "domcontentloaded" });
await load;
await page.waitForTimeout(4000);
await page.screenshot({ path: OUT });
console.log("SAVED", OUT);
await browser.close();
