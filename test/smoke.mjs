// Smoke test for habit-arrr.html — loads the file directly in a headless browser (no build step,
// no server) and exercises the core loop: add a habit, complete it, confirm XP/streaks/achievements
// update and nothing throws. Run with:
//
//   npm install -D playwright   (once)
//   node test/smoke.mjs
//
// Exits non-zero on any failed check, so it can be wired into CI later if this repo ever gets one.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + path.join(here, '..', 'habit-arrr.html');

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures.push(name);
};

async function run() {
  const browser = await chromium.launch();
  try {
    for (const viewport of [{ width: 360, height: 740 }, { width: 1280, height: 900 }]) {
      const page = await browser.newPage({ viewport });
      const consoleErrors = [];
      page.on('pageerror', e => consoleErrors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) consoleErrors.push(m.text()); });

      await page.goto(appUrl);
      await page.waitForTimeout(400);
      check(`[${viewport.width}px] loads with no console errors`, consoleErrors.length === 0);

      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      check(`[${viewport.width}px] no horizontal overflow`, !overflowX);

      await page.fill('#quest-name', 'Smoke test habit');
      await page.selectOption('#quest-diff', 'hard');
      await page.click('#add-form button[type=submit]');
      const xpBefore = await page.textContent('.stat b');
      await page.click('.quest .complete');
      await page.waitForTimeout(600);
      const xpAfter = await page.textContent('.stat b');
      check(`[${viewport.width}px] completing a habit increases total XP`, Number(xpAfter) > Number(xpBefore));

      const doneToday = await page.textContent('.stats .stat:nth-child(3) b');
      check(`[${viewport.width}px] "done today" reflects the completion`, doneToday.trim().startsWith('1/'));

      const trophyUnlocked = await page.locator('.ach-grid .ach:not(.locked)').count();
      check(`[${viewport.width}px] first-completion achievement unlocked`, trophyUnlocked >= 1);

      await page.click('#export');
      await page.waitForTimeout(200);
      check(`[${viewport.width}px] export produced no console errors`, consoleErrors.length === 0);

      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${failures.length === 0 ? 'All checks passed.' : `${failures.length} check(s) failed:`}`);
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(failures.length === 0 ? 0 : 1);
}

run();
