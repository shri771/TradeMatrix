import { chromium } from "playwright";
const URL = "http://localhost:5173";
const OUT = process.argv[2] || "/tmp/tm_fresh.png";

const browser = await chromium.launch({ executablePath: "/run/current-system/sw/bin/brave", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("PAGE.err:", m.text()); });

// Wipe ALL storage so the app boots on its own defaults (4x BTC 1m), exactly
// like a user's "fresh load" but with no accumulated state.
await page.addInitScript(() => { try { localStorage.clear(); } catch {} });

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000); // let 4 panes load candles + settle
await page.screenshot({ path: OUT });
console.log("SAVED", OUT);
await browser.close();
