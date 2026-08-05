/**
 * Live card-dimension audit: Forwardtester vs Backtester Logic Atlas + desk cards.
 * Run: npx --yes playwright@1.49.0 install chromium && node scripts/ui_card_audit.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "tmp_ui_audit");
fs.mkdirSync(outDir, { recursive: true });

const FT = process.env.FT_URL || "http://127.0.0.1:3000";
const BT = process.env.BT_URL || "http://127.0.0.1:3010";

async function measurePage(page, label, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);

  // dismiss any obvious overlays if present
  try {
    await page.keyboard.press("Escape");
  } catch {}

  const shot = path.join(outDir, `${label}-logic.png`);
  await page.screenshot({ path: shot, fullPage: true });

  const metrics = await page.evaluate(() => {
    const q = (sel) => Array.from(document.querySelectorAll(sel));
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        minW: cs.minWidth,
        maxW: cs.maxWidth,
        flex: cs.flex,
        minH: cs.minHeight,
        clamp: (() => {
          const p = el.querySelector("p.mt-1, p[class*='line-clamp']");
          if (!p) return null;
          const c = getComputedStyle(p);
          return {
            lineClamp: c.webkitLineClamp || c.lineClamp,
            text: (p.textContent || "").trim().slice(0, 140),
            h: Math.round(p.getBoundingClientRect().height * 10) / 10,
          };
        })(),
      };
    };

    const pipelineItems = q(".logic-pipeline-item").map((el) => box(el));
    const nodes = q(".logic-node").map((el) => box(el));
    const moduleCards = q(".logic-module-card").map((el) => box(el));
    const deskStats = q(".desk-stat-card").map((el) => box(el));
    const sheetCards = q(".sheet-card").map((el) => box(el));
    const noteCards = q(".intel-note-card").map((el) => box(el));
    const resultCards = q(".computation-result-card").map((el) => box(el));
    const metaChips = q(".meta-chip").slice(0, 6).map((el) => box(el));

    const widths = (arr) => {
      const ws = arr.map((b) => b?.w).filter((x) => typeof x === "number");
      if (!ws.length) return null;
      return {
        n: ws.length,
        min: Math.min(...ws),
        max: Math.max(...ws),
        mean: Math.round((ws.reduce((a, b) => a + b, 0) / ws.length) * 10) / 10,
        sample: arr.slice(0, 3),
      };
    };

    const heights = (arr) => {
      const hs = arr.map((b) => b?.h).filter((x) => typeof x === "number");
      if (!hs.length) return null;
      return {
        n: hs.length,
        min: Math.min(...hs),
        max: Math.max(...hs),
        mean: Math.round((hs.reduce((a, b) => a + b, 0) / hs.length) * 10) / 10,
      };
    };

    return {
      title: document.title,
      url: location.href,
      rootFont: getComputedStyle(document.documentElement).fontSize,
      pipelineItemW: widths(pipelineItems),
      pipelineItemH: heights(pipelineItems),
      nodeW: widths(nodes),
      nodeH: heights(nodes),
      nodeSamples: nodes.slice(0, 5),
      moduleCardW: widths(moduleCards),
      moduleCardH: heights(moduleCards),
      deskStatW: widths(deskStats),
      deskStatH: heights(deskStats),
      sheetCardW: widths(sheetCards),
      noteCardW: widths(noteCards),
      resultCardW: widths(resultCards),
      metaChipW: widths(metaChips),
      cssVars: {
        logicModule: getComputedStyle(document.documentElement).getPropertyValue("--logic-module-card-width").trim(),
      },
    };
  });

  return { label, url, shot, metrics };
}

async function measureHome(page, label, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  const shot = path.join(outDir, `${label}-home.png`);
  await page.screenshot({ path: shot, fullPage: false });
  const metrics = await page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
    };
    const desk = Array.from(document.querySelectorAll(".desk-stat-card")).map(box);
    const panels = Array.from(document.querySelectorAll(".ar-panel")).slice(0, 8).map(box);
    const sheet = Array.from(document.querySelectorAll(".sheet-card")).slice(0, 6).map(box);
    return { desk, panels, sheet, title: document.title };
  });
  return { label, url, shot, metrics };
}

function compare(ft, bt) {
  const issues = [];
  const checkW = (name, a, b, tol = 2) => {
    if (!a || !b) {
      issues.push(`${name}: missing FT=${!!a} BT=${!!b}`);
      return;
    }
    const dMin = Math.abs(a.min - b.min);
    const dMax = Math.abs(a.max - b.max);
    const dMean = Math.abs(a.mean - b.mean);
    if (dMin > tol || dMax > tol || dMean > tol) {
      issues.push(
        `${name} WIDTH drift >${tol}px: FT min/mean/max=${a.min}/${a.mean}/${a.max} vs BT ${b.min}/${b.mean}/${b.max}`,
      );
    }
  };

  checkW("logic-pipeline-item", ft.pipelineItemW, bt.pipelineItemW, 4);
  checkW("logic-node", ft.nodeW, bt.nodeW, 4);
  checkW("logic-module-card", ft.moduleCardW, bt.moduleCardW, 4);

  // Height: FT should be taller (extra lines), not narrower width
  if (ft.nodeH && bt.nodeH) {
    if (ft.nodeH.mean < bt.nodeH.mean - 1) {
      issues.push(
        `logic-node HEIGHT: FT should be >= BT (extra lines). FT mean=${ft.nodeH.mean} BT mean=${bt.nodeH.mean}`,
      );
    }
  }

  // Clamp should be 6 on FT and 3 on BT
  const ftClamp = ft.nodeSamples?.[0]?.clamp?.lineClamp;
  const btClamp = bt.nodeSamples?.[0]?.clamp?.lineClamp;
  if (String(ftClamp) !== "6") issues.push(`FT line-clamp expected 6 got ${ftClamp}`);
  if (String(btClamp) !== "3") issues.push(`BT line-clamp expected 3 got ${btClamp}`);

  // Description text length: FT blurbs should be longer
  const ftText = ft.nodeSamples?.[0]?.clamp?.text || "";
  const btText = bt.nodeSamples?.[0]?.clamp?.text || "";
  if (ftText.length <= btText.length) {
    issues.push(`FT blurb not longer than BT (FT ${ftText.length} vs BT ${btText.length} chars)`);
  }

  return issues;
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const results = {};
try {
  results.ftLogic = await measurePage(page, "ft", `${FT}/intel/logic`);
  results.btLogic = await measurePage(page, "bt", `${BT}/intel/logic`);
  results.ftHome = await measureHome(page, "ft", `${FT}/`);
  results.btHome = await measureHome(page, "bt", `${BT}/`);

  // Product page cards
  await page.goto(`${FT}/product`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(outDir, "ft-product.png"), fullPage: true });
  results.ftProduct = await page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, cls: el.className.slice(0, 80) };
    };
    return {
      panels: Array.from(document.querySelectorAll(".ar-panel")).slice(0, 10).map(box),
      sheets: Array.from(document.querySelectorAll(".sheet-card")).slice(0, 10).map(box),
      meta: Array.from(document.querySelectorAll(".meta-chip")).slice(0, 8).map(box),
    };
  });

  await page.goto(`${BT}/product`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(outDir, "bt-product.png"), fullPage: true });
  results.btProduct = await page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, cls: el.className.slice(0, 80) };
    };
    return {
      panels: Array.from(document.querySelectorAll(".ar-panel")).slice(0, 10).map(box),
      sheets: Array.from(document.querySelectorAll(".sheet-card")).slice(0, 10).map(box),
      meta: Array.from(document.querySelectorAll(".meta-chip")).slice(0, 8).map(box),
    };
  });

  const issues = compare(results.ftLogic.metrics, results.btLogic.metrics);

  // Module card CSS var
  if (results.ftLogic.metrics.cssVars.logicModule !== results.btLogic.metrics.cssVars.logicModule) {
    issues.push(
      `CSS --logic-module-card-width FT=${results.ftLogic.metrics.cssVars.logicModule} BT=${results.btLogic.metrics.cssVars.logicModule}`,
    );
  }

  const report = { issues, results };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));

  console.log("=== CARD AUDIT ===");
  console.log(
    "FT pipeline W",
    results.ftLogic.metrics.pipelineItemW,
    "H",
    results.ftLogic.metrics.pipelineItemH,
  );
  console.log(
    "BT pipeline W",
    results.btLogic.metrics.pipelineItemW,
    "H",
    results.btLogic.metrics.pipelineItemH,
  );
  console.log("FT node W", results.ftLogic.metrics.nodeW, "H", results.ftLogic.metrics.nodeH);
  console.log("BT node W", results.btLogic.metrics.nodeW, "H", results.btLogic.metrics.nodeH);
  console.log("FT module", results.ftLogic.metrics.moduleCardW, results.ftLogic.metrics.moduleCardH);
  console.log("BT module", results.btLogic.metrics.moduleCardW, results.btLogic.metrics.moduleCardH);
  console.log("FT clamp sample", results.ftLogic.metrics.nodeSamples?.[0]?.clamp);
  console.log("BT clamp sample", results.btLogic.metrics.nodeSamples?.[0]?.clamp);
  console.log("FT desk home", results.ftHome.metrics.desk);
  console.log("BT desk home", results.btHome.metrics.desk);
  if (issues.length) {
    console.log("ISSUES:");
    for (const i of issues) console.log(" -", i);
    process.exitCode = 2;
  } else {
    console.log("PASS — widths match BT; FT nodes taller with longer blurbs / clamp-6");
  }
} catch (err) {
  console.error("AUDIT FAILED", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
