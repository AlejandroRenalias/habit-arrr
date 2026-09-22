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

      // Regression: deleting a habit used window.confirm(), which blocks or hangs forever in a sandboxed
      // iframe (e.g. an embedded artifact) — the app now uses its own in-page confirm modal instead.
      const countBefore = await page.locator('.quest').count();
      await page.click('.quest button.del');
      await page.waitForTimeout(150);
      check(`[${viewport.width}px] delete shows the custom confirm modal`, await page.locator('#confirm-modal.show').count() === 1);
      await page.click('#confirm-cancel');
      await page.waitForTimeout(150);
      check(`[${viewport.width}px] cancel keeps the habit`, await page.locator('.quest').count() === countBefore);
      await page.click('.quest button.del');
      await page.click('#confirm-ok');
      await page.waitForTimeout(150);
      check(`[${viewport.width}px] confirm deletes the habit`, await page.locator('.quest').count() === countBefore - 1);

      await page.close();
    }

    // Storm surge: telegraphed (warns a day ahead when the lead is tense) and fair (only strikes if idle
    // on the warned day). Force Math.random so the warning always fires, then seed a state where a storm
    // was already warned for "yesterday" and the player stayed idle through it.
    {
      const page = await browser.newPage();
      await page.addInitScript(() => { Math.random = () => 0; });
      await page.goto(appUrl);
      await page.evaluate(() => {
        const pad = n => String(n).padStart(2, '0');
        const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const today = fmt(new Date());
        const s = {
          habits: [{ id: 'h1', name: 'Test', difficulty: 'medium', cat: 'other', streak: 0, lastDone: null, totalDone: 0 }],
          totalXp: 0, achievements: [], bestStreak: 0, voyage: { chart: 1, p: 5 }, k: 3,
          drag: false, slowNotice: false, current: false, streak: 0, lastActive: null, tickedThrough: today,
          sunkNotice: false, caged: false, stormDay: null, stormWarnNotice: false, stormHitNotice: false, stormAvertedNotice: false,
        };
        localStorage.setItem('habit-quest-v1', JSON.stringify(s));
      });
      await page.reload();
      await page.waitForTimeout(300);
      await page.click('.quest .complete'); // gap is tense (2) and Math.random is forced low, so this should warn
      await page.waitForTimeout(300);
      const afterWarn = await page.evaluate(() => JSON.parse(localStorage.getItem('habit-quest-v1')));
      check('storm warning is scheduled for the next day when the lead is tense', !!afterWarn.stormDay);

      await page.evaluate(() => {
        const pad = n => String(n).padStart(2, '0');
        const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const addDays = (base, n) => { const d = new Date(base); d.setDate(d.getDate() + n); return fmt(d); };
        const twoDaysAgo = addDays(new Date(), -2);
        const yday = addDays(new Date(), -1);
        const s = JSON.parse(localStorage.getItem('habit-quest-v1'));
        s.lastActive = twoDaysAgo; s.tickedThrough = twoDaysAgo; s.stormDay = yday; // storm was due yesterday, player stayed idle
        localStorage.setItem('habit-quest-v1', JSON.stringify(s));
      });
      await page.reload();
      await page.waitForTimeout(300);
      const afterHit = await page.evaluate(() => JSON.parse(localStorage.getItem('habit-quest-v1')));
      check('an unmet storm warning pushes the ship back and clears itself', afterHit.stormDay === null && afterHit.voyage.p < 5);

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
