import { chromium } from "playwright";

const URL = "http://localhost:5173";
const OUT = process.argv[2] || "/tmp/tm.png";
const SOURCE = process.argv[3] || "databento";
const SYMBOL = process.argv[4] || "NQ.c.0";
const INTERVAL = process.argv[5] || "15m";

const pane = { source: SOURCE, symbol: SYMBOL, interval: INTERVAL, indicators: [], htfs: ["1h", "4h", "1d"] };

const browser = await chromium.launch({ executablePath: "/run/current-system/sw/bin/brave", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("PAGE.err:", m.text()); });

// Seed BEFORE any app code runs (avoids the app persisting its defaults over
// our seed between load and reload).
await page.addInitScript((p) => {
  localStorage.setItem("tm:chartCount", "1");
  localStorage.setItem("tm:panes", JSON.stringify([p]));
}, pane);

const candleResp = (iv) => (r) => r.url().includes("/api/candles") && r.url().includes(`interval=${iv}`) && r.status() === 200;
const waits = [INTERVAL, "1h", "4h", "1d"].map((iv) =>
  page.waitForResponse(candleResp(iv), { timeout: 90000 }).then(() => console.log(`${iv} loaded`)).catch(() => console.log(`WARN ${iv} timeout`)));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await Promise.all(waits);
await page.waitForTimeout(6000); // let HTF override + repaint settle

await page.screenshot({ path: OUT });
console.log("SAVED", OUT);
await browser.close();
