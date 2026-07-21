import { chromium } from "playwright";
const URL = "http://localhost:5173";
const pane = { source: "hyperliquid", symbol: "BTC", interval: "15m", indicators: [], htfs: ["1h", "4h", "1d"] };

const browser = await chromium.launch({ executablePath: "/run/current-system/sw/bin/brave", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("PAGE.err:", m.text()); });

await page.addInitScript((p) => {
  localStorage.setItem("tm:chartCount", "1");
  localStorage.setItem("tm:panes", JSON.stringify([p]));
}, pane);

const c15 = (r) => r.url().includes("/api/candles") && r.url().includes("interval=15m") && r.status() === 200;
const load1 = page.waitForResponse(c15, { timeout: 60000 }).catch(() => {});
await page.goto(URL, { waitUntil: "domcontentloaded" });
await load1;
await page.waitForTimeout(4000);
await page.screenshot({ path: "/tmp/tm_rhtf_live.png" });
console.log("live shot done");

// Enter replay
await page.click('button[title="Bar replay"]');
await page.waitForTimeout(6000); // replay history + HTF refetch
await page.screenshot({ path: "/tmp/tm_rhtf_replay.png" });
console.log("replay shot done");
await browser.close();
