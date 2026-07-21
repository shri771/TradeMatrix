import { chromium } from "playwright";

const URL = "http://localhost:5173";
// NQ with SMT enabled; correlates ES/YM fetched by the pane.
const pane = { source: "databento", symbol: "NQ.c.0", interval: "15m", indicators: [], htfs: [], smt: true };

const browser = await chromium.launch({ executablePath: "/run/current-system/sw/bin/brave", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("PAGE.err:", m.text()); });

await page.addInitScript((p) => {
  localStorage.setItem("tm:chartCount", "1");
  localStorage.setItem("tm:panes", JSON.stringify([p]));
}, pane);

const c15 = (r) => r.url().includes("/api/candles") && r.url().includes("interval=15m") && r.status() === 200;
const load1 = page.waitForResponse(c15, { timeout: 90000 }).catch(() => {});
await page.goto(URL, { waitUntil: "domcontentloaded" });
await load1;
// Poll for the SMT diagnostic — first correlate fetch can be a slow Databento
// cache miss (~10-15s). `pred` lets us wait for a specific state (e.g. a seated
// replay clock) rather than just the first detect.
const waitSmt = async (ms, pred = (d) => !!d) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const d = await page.evaluate(() => window.__tmSmt ?? null);
    if (d && pred(d)) return d;
    await page.waitForTimeout(500);
  }
  return await page.evaluate(() => window.__tmSmt ?? null);
};

const live = await waitSmt(60000);
await page.screenshot({ path: "/tmp/tm_smt_live.png" });
console.log("LIVE diag:", JSON.stringify(live));

// Enter replay — clear the diag, then wait for a SEATED clock (non-null) so we
// capture the clipped, point-in-time detection rather than the transient first
// pass that runs before the replay clock is seated.
await page.evaluate(() => { window.__tmSmt = null; });
await page.click('button[title="Bar replay"]');
const replay = await waitSmt(40000, (d) => d.isReplay && d.clock != null);
await page.screenshot({ path: "/tmp/tm_smt_replay.png" });
console.log("REPLAY diag:", JSON.stringify(replay));

// Step forward ~20 bars to confirm SMT re-detects as the clock advances.
const before = replay?.clock;
await page.evaluate(() => { window.__tmSmt = null; });
for (let i = 0; i < 20; i++) { await page.click('button[title="Step forward"]'); await page.waitForTimeout(120); }
const stepped = await waitSmt(20000, (d) => d.isReplay && d.clock != null && d.clock !== before);
await page.screenshot({ path: "/tmp/tm_smt_replay_stepped.png" });
console.log("STEPPED diag:", JSON.stringify(stepped));

await browser.close();
