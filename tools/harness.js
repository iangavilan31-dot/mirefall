import { chromium } from 'playwright';

export const URL_BASE = process.env.MIREFALL_URL || 'http://localhost:5135/';

/**
 * Boots the real game in headless Chromium with GPU-ish flags, waits for the
 * debug API, and returns { browser, page, api helpers }.
 */
export async function launch({ width = 1920, height = 1080, quality = null, headless = true } = {}) {
  const browser = await chromium.launch({
    headless,
    args: [
      '--use-angle=default',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
      '--disable-features=IsolateOrigins,site-per-process',
      '--autoplay-policy=no-user-gesture-required',
      '--force-device-scale-factor=1',
    ],
  });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });

  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // wait for boot (procedural texture synthesis takes a moment)
  await page.waitForFunction(() => window.__MIREFALL_READY__ === true || window.__MIREFALL_FATAL__, { timeout: 120000 });

  const fatal = await page.evaluate(() => window.__MIREFALL_FATAL__ || null);
  if (fatal) {
    await browser.close();
    throw new Error('Game failed to boot:\n' + fatal + '\n\nConsole:\n' + logs.join('\n'));
  }

  if (quality) await page.evaluate((q) => window.__MIREFALL__.setQuality(q), quality);

  const api = {
    call: (fn, ...args) => page.evaluate(({ fn, args }) => {
      const f = window.__MIREFALL__[fn];
      return typeof f === 'function' ? f(...args) : f;
    }, { fn, args }),
    /** Run a snippet inside the page with `M` bound to the debug API. Supports await. */
    eval: (fnStr, arg) => page.evaluate(({ src, arg }) => {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      return new AsyncFunction('arg', `const M = window.__MIREFALL__; ${src}`)(arg);
    }, { src: fnStr, arg }),
    /** Advance N rendered frames. */
    frames: async (n = 1) => {
      await page.evaluate((count) => new Promise((res) => {
        let i = 0;
        const tick = () => { if (++i >= count) res(); else requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      }), n);
    },
    settle: async (seconds = 1.0) => {
      await page.waitForTimeout(seconds * 1000);
      await api.frames(4);
    },
    /**
     * Wait until a page-side expression is truthy. Prefer this over settle() for anything
     * gated on SIMULATION time: dt is clamped to 1/20 s per frame, so on a loaded machine
     * simulated time advances more slowly than wall-clock and fixed sleeps become flaky.
     */
    waitFor: async (expr, { timeout = 30000, label = expr } = {}) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        const ok = await page.evaluate((src) => {
          try { return !!new Function('M', `return (${src});`)(window.__MIREFALL__); }
          catch { return false; }
        }, expr);
        if (ok) return true;
        await page.waitForTimeout(120);
      }
      throw new Error(`waitFor timed out after ${timeout}ms: ${label}`);
    },
    logs: () => logs,
  };

  return { browser, page, api, logs };
}

export async function shoot(page, path, clip = null) {
  await page.screenshot({ path, clip: clip || undefined, animations: 'allow' });
  return path;
}
