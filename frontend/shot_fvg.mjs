import { chromium } from "playwright";
const URL = "http://localhost:5173";
const OUT = process.argv[2] || "/tmp/tm_fvg.png";
const SOURCE = process.argv[3] || "hyperliquid";
const SYMBOL = process.argv[4] || "BTC";
const INTERVAL = process.argv[5] || "5m";
const pane = { source: SOURCE, symbol: SYMBOL, interval: INTERVAL, indicators: [], htfs: [], fvg: true };

const browser = await chromium.launch({ executablePath: "/run/current-system/sw/bin/brave", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("PAGE.err:", m.text()); });

await page.addInitScript((p) => {
  localStorage.setItem("tm:chartCount", "1");
  localStorage.setItem("tm:panes", JSON.stringify([p]));
}, pane);

const cc = (r) => r.url().includes("/api/candles") && r.url().includes(`interval=${INTERVAL}`) && r.status() === 200;
const load = page.waitForResponse(cc, { timeout: 90000 }).catch(() => console.log("WARN candle timeout"));
await page.goto(URL, { waitUntil: "domcontentloaded" });
await load;
await page.waitForTimeout(3500);

await page.screenshot({ path: OUT });
// A zoomed crop of the middle so the gap boxes are easy to inspect.
await page.screenshot({ path: OUT.replace(".png", "_crop.png"), clip: { x: 500, y: 200, width: 700, height: 520 } });
console.log("SAVED", OUT);
await browser.close();
