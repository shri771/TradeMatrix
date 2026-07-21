import { chromium } from "playwright";

const URL = "http://localhost:5173";
const pane = { source: "databento", symbol: "NQ.c.0", interval: "15m", indicators: [], htfs: [] };

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
await page.waitForTimeout(8000);

const host = await page.locator(".chart-host").boundingBox();
const at = (fx, fy) => ({ x: host.x + host.width * fx, y: host.y + host.height * fy });

// Draw a trend line (custom trendLine = 2 clicks).
await page.click('button[title="Drawing tools"]');
await page.click('.menu-item:has-text("Trend line")');
let p = at(0.30, 0.45); await page.mouse.click(p.x, p.y); await page.waitForTimeout(300);
p = at(0.45, 0.45); await page.mouse.click(p.x, p.y); await page.waitForTimeout(400);

// Draw a rectangle (built-in rect = 2 clicks).
await page.click('button[title="Drawing tools"]');
await page.click('.menu-item:has-text("Rectangle")');
p = at(0.55, 0.30); await page.mouse.click(p.x, p.y); await page.waitForTimeout(300);
p = at(0.70, 0.55); await page.mouse.click(p.x, p.y); await page.waitForTimeout(400);

// Draw a long position (2 clicks).
await page.click('button[title="Long position"]');
p = at(0.78, 0.60); await page.mouse.click(p.x, p.y); await page.waitForTimeout(300);
p = at(0.88, 0.40); await page.mouse.click(p.x, p.y); await page.waitForTimeout(400);

// Open the delete menu and list rows.
await page.click('button[title="Delete drawings"]');
await page.waitForTimeout(400);
const rowsBefore = await page.locator(".draw-row").allInnerTexts();
console.log("ROWS before:", JSON.stringify(rowsBefore));
await page.screenshot({ path: "/tmp/tm_del_menu.png" });

// Delete the first drawing (Trend line 1).
await page.locator(".draw-row .draw-del").first().click();
await page.waitForTimeout(500);
const rowsAfter = await page.locator(".draw-row").allInnerTexts();
console.log("ROWS after deleting first:", JSON.stringify(rowsAfter));
await page.screenshot({ path: "/tmp/tm_del_after.png" });

await browser.close();
