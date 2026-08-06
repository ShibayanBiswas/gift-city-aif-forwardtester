/**
 * Live Logic Atlas uniformity + text/style audit.
 * Run from repo root after UI is up:
 *   node scripts/ui_atlas_live_audit.mjs
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "tmp_ui_audit");
fs.mkdirSync(outDir, { recursive: true });

const URL = process.env.FT_URL || "http://127.0.0.1:3000/intel/logic";
const BAD = /[₀₁₂₃₄₅₆₇₈₉ΣΔτσ≤≥∈≈×±−→⇒←∞]|\\frac|\\times|\\sum|Spot₀|\\\(|\\\[/;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(URL, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForSelector(".logic-module-card", { timeout: 60000 });
await page.waitForTimeout(1500);

const moduleButtons = page.locator(".logic-module-card");
const moduleCount = await moduleButtons.count();
const report = { modules: [], issues: [], moduleCardHeights: [] };

for (let i = 0; i < moduleCount; i++) {
  await moduleButtons.nth(i).click();
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelector(".intel-pipeline-shell")?.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(250);

  const shot = path.join(outDir, `atlas-mod-${i}.png`);
  await page.screenshot({ path: shot, fullPage: false });

  const data = await page.evaluate(() => {
    const title = document.querySelector(".intel-section-head h2")?.textContent?.trim() || "";
    const purpose = document.querySelector(".intel-section-head p.mt-1.max-w-3xl")?.textContent?.trim() || "";
    const nodes = [...document.querySelectorAll(".logic-node")].map((el) => {
      const r = el.getBoundingClientRect();
      const texts = [...el.querySelectorAll("p")].map((p) => (p.textContent || "").trim()).filter(Boolean);
      const desc = el.querySelector(".line-clamp-2");
      const descStyle = desc ? getComputedStyle(desc) : null;
      return {
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        label: el.querySelector(".text-\\[0\\.95rem\\]")?.textContent?.trim() || "",
        texts,
        descClamp: descStyle?.webkitLineClamp || null,
        descH: desc ? Math.round(desc.getBoundingClientRect().height * 10) / 10 : null,
      };
    });
    const defaults = [...document.querySelectorAll(".meta-chip")].map((el) => (el.textContent || "").replace(/\s+/g, " ").trim());
    const outputs = [...document.querySelectorAll(".intel-output-chip")].map((el) => (el.textContent || "").trim());
    const moduleCards = [...document.querySelectorAll(".logic-module-card")].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200),
      };
    });
    const hero = document.querySelector(".intel-hero-sub")?.textContent?.trim() || "";
    return { title, purpose, nodes, defaults, outputs, moduleCards, hero };
  });

  const widths = data.nodes.map((n) => n.w);
  const heights = data.nodes.map((n) => n.h);
  const wMin = Math.min(...widths);
  const wMax = Math.max(...widths);
  const hMin = Math.min(...heights);
  const hMax = Math.max(...heights);

  if (wMax - wMin > 2) report.issues.push(`${data.title}: node width spread ${wMin}-${wMax}`);
  if (hMax - hMin > 2) report.issues.push(`${data.title}: node height spread ${hMin}-${hMax}`);

  const modH = data.moduleCards.map((m) => m.h);
  report.moduleCardHeights = modH;
  if (modH.length && Math.max(...modH) - Math.min(...modH) > 4) {
    report.issues.push(`Module cards height spread ${Math.min(...modH)}-${Math.max(...modH)}`);
  }

  const texts = [
    data.hero,
    data.purpose,
    ...data.defaults,
    ...data.outputs,
    ...data.nodes.flatMap((n) => n.texts),
    ...data.moduleCards.map((m) => m.text),
  ];
  for (const t of texts) {
    if (BAD.test(t)) report.issues.push(`${data.title}: symbol/latex → ${t.slice(0, 120)}`);
  }

  for (const n of data.nodes) {
    if (n.descClamp && n.descClamp !== "2") {
      report.issues.push(`${data.title}/${n.label}: description clamp is ${n.descClamp}, want 2`);
    }
  }

  report.modules.push({
    title: data.title,
    nodeCount: data.nodes.length,
    widthRange: [wMin, wMax],
    heightRange: [hMin, hMax],
    sampleDesc: data.nodes[0]?.texts?.find((t) => t.length > 40)?.slice(0, 140),
    defaults: data.defaults.slice(0, 4),
    shot,
  });
}

fs.writeFileSync(path.join(outDir, "atlas_live_report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.issues.length) {
  console.error("FAIL", report.issues.length, "issues");
  process.exitCode = 2;
} else {
  console.log("PASS uniform cards + no latex/symbol bugs");
}
await browser.close();
