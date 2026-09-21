import { test, expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

async function ready(page: Page) {
  await page.goto('./');
  await expect(page.locator('#scene')).toHaveAttribute('data-rendered', 'true');
  await expect(page.locator('#scene')).toHaveAttribute('data-framed', '10');
  await expect(page.locator('#scene')).toHaveAttribute('data-ground-framed', 'true');
}

async function range(page: Page, id: string, value: number) {
  await page.locator(`#${id}`).evaluate((element, next) => {
    (element as HTMLInputElement).value = String(next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function pixels(page: Page) {
  const screenshot = await page.locator('#scene canvas').screenshot();
  const image = PNG.sync.read(screenshot);
  const colors = new Set<string>();
  for (let offset = 0; offset < image.data.length; offset += 64) {
    colors.add(`${image.data[offset] >> 4},${image.data[offset + 1] >> 4},${image.data[offset + 2] >> 4}`);
  }
  expect(image.width).toBeGreaterThan(250);
  expect(image.height).toBeGreaterThan(300);
  expect(colors.size).toBeGreaterThan(40);
  return screenshot;
}

async function layout(page: Page) {
  const problems = await page.evaluate(() => {
    const issues: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('page overflow');
    const labels = [...document.querySelectorAll<HTMLElement>('.node-label')]
      .filter(element => getComputedStyle(element).visibility === 'visible')
      .map(element => element.getBoundingClientRect());
    for (const [index, box] of labels.entries()) {
      for (const other of labels.slice(index + 1)) {
        if (box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top) issues.push('labels overlap');
      }
    }
    for (const element of document.querySelectorAll<HTMLElement>('.metrics > div, .answer, .panel-section, .node-label, .code-block')) {
      if (element.offsetWidth && element.scrollWidth > element.clientWidth + 1) issues.push(`overflow: ${element.className}`);
    }
    return issues;
  });
  expect(problems).toEqual([]);
}

test('production page renders locally with a nonblank framed city and parallel questions', async ({ page }) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4198/')) external.push(request.url()); });
  await ready(page);
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('#metric-calls')).toHaveText('0');
  await pixels(page);
  await page.getByRole('button', { name: 'Go to Questions stage' }).click();
  await expect(page.locator('#scene')).toHaveAttribute('data-active-links', '3');
  await expect(page.locator('#metric-calls')).toHaveText('1');
  await expect(page.locator('#metric-answers')).toHaveText('0 / 3');
  await page.getByRole('button', { name: 'Step flow', exact: true }).click();
  await expect(page.locator('#metric-answers')).toHaveText('3 / 3');
  await expect(page.locator('#choice-value')).toHaveText('technical');
  await expect(page.locator('#noul-value')).toHaveText('0.96');
  await expect(page.locator('#score-value')).toHaveText('1.90 / 2');
  await expect(page.locator('#score-confidence')).toHaveText('confidence 0.85');
  await layout(page);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('every fixture reaches its exact outcome and classifier/handler counts', async ({ page }) => {
  await ready(page);
  for (const [scenario, outcome, calls, handler] of [
    ['outage', 'passed', '3', '1'], ['ambiguous', 'review', '1', '0'], ['routine', 'passed', '3', '1'],
    ['high-risk', 'blocked', '3', '0'], ['failure', 'error', '3', '0'], ['unlisted', 'bypass', '2', '1'],
  ]) {
    await page.getByRole('combobox', { name: 'Scenario' }).selectOption(scenario);
    await expect(page.locator('#app')).toHaveAttribute('data-tick', '0');
    await page.getByRole('button', { name: 'Go to Outcome stage' }).click();
    await expect(page.locator('#app')).toHaveAttribute('data-outcome', outcome);
    await expect(page.locator('#metric-calls')).toHaveText(calls);
    await expect(page.locator('#metric-handler')).toHaveText(handler);
    await expect(page.getByRole('button', { name: 'Step flow', exact: true })).toBeDisabled();
  }
  await expect(page.locator('#summary')).toContainText('Guard bypass');
  await expect(page.locator('#ledger-risk')).toHaveText('0');
});

test('policy thresholds reset the run and change the actual route', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Go to Outcome stage' }).click();
  await expect(page.locator('#metric-handler')).toHaveText('1');
  await range(page, 'control-confidenceFloor', .95);
  await expect(page.locator('#app')).toHaveAttribute('data-tick', '0');
  await page.getByRole('button', { name: 'Go to Outcome stage' }).click();
  await expect(page.locator('#metric-handler')).toHaveText('0');
  await expect(page.locator('#metric-route')).toHaveText('Review');
  await range(page, 'control-confidenceFloor', .7);
  await page.getByRole('button', { name: 'Go to Outcome stage' }).click();
  await expect(page.locator('#metric-handler')).toHaveText('1');
  await page.getByRole('button', { name: 'Reset flow', exact: true }).click();
  await expect(page.locator('#metric-calls')).toHaveText('0');
});

test('inspector, keyboard tabs and snapshot export expose the model boundaries', async ({ page }) => {
  await ready(page);
  await page.locator('[data-inspect="choice"]').click();
  await expect(page.locator('#district-name')).toHaveText('Choice');
  await expect(page.locator('#district-code')).toContainText('response.choices');
  await page.locator('[data-district="guard"]').click();
  await expect(page.locator('#district-detail')).toContainText('Unlisted tools bypass');
  await page.getByRole('tab', { name: 'Inspector', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Evaluation', exact: true })).toBeFocused();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export simulation snapshot' }).click();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const snapshot = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(snapshot.realModelCalled).toBe(false);
  expect(snapshot.realToolExecuted).toBe(false);
  expect(snapshot.evaluation.mode).toBe('six synthetic labeled cases');
});

test('evaluation threshold preserves Brier and reveals precision/recall counts', async ({ page }) => {
  await ready(page);
  await page.getByRole('tab', { name: 'Evaluation', exact: true }).click();
  await expect(page.locator('#precision')).toHaveText('50%');
  await expect(page.locator('#recall')).toHaveText('33%');
  await expect(page.locator('#brier')).toHaveText('0.18625');
  await range(page, 'evaluation-threshold', .95);
  await expect(page.locator('#precision')).toHaveText('100%');
  await expect(page.locator('#false-positive')).toHaveText('0');
  await expect(page.locator('#false-negative')).toHaveText('2');
  await expect(page.locator('#brier')).toHaveText('0.18625');
  await range(page, 'evaluation-threshold', 1);
  await expect(page.locator('#precision')).toHaveText('n/a');
});

test('animation moves canvas content and respects pause and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install({ time: new Date('2026-09-21T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-21T12:00:01Z'));
  await page.goto('./');
  await page.clock.runFor(100);
  await expect(page.locator('#scene')).toHaveAttribute('data-rendered', 'true');
  await page.getByRole('button', { name: 'Go to Questions stage' }).click();
  await page.getByRole('button', { name: 'Play flow', exact: true }).click();
  await page.clock.runFor(100);
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'questions');
  const before = await pixels(page);
  await page.clock.runFor(250);
  const after = await pixels(page);
  expect(before.equals(after)).toBe(false);
  await page.getByRole('button', { name: 'Pause flow', exact: true }).click();
  const tick = await page.locator('#app').getAttribute('data-tick');
  await page.clock.runFor(1600);
  await expect(page.locator('#app')).toHaveAttribute('data-tick', tick!);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Reset flow', exact: true }).click();
  await page.clock.runFor(1600);
  await expect(page.locator('#app')).toHaveAttribute('data-tick', '0');
});

test('mobile layout and both cameras keep the city framed without text collisions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await pixels(page);
  await layout(page);
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(page.locator('#scene')).toHaveAttribute('data-camera', 'plan');
  await expect(page.locator('#scene')).toHaveAttribute('data-framed', '10');
  await expect(page.locator('#scene')).toHaveAttribute('data-ground-framed', 'true');
  await layout(page);
  await page.getByRole('button', { name: 'City', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Frame city', exact: true }).click();
  await expect(page.locator('#scene')).toHaveAttribute('data-framed', '10');
  await page.getByRole('tab', { name: 'Evaluation', exact: true }).click();
  await range(page, 'evaluation-threshold', .95);
  await expect(page.locator('#precision')).toHaveText('100%');
  await layout(page);
});

test('without WebGL the decision model and inspector still work', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind: string, ...options: unknown[]) {
      if (kind === 'webgl2' || kind === 'webgl' || kind === 'experimental-webgl') return null;
      return original.apply(this, [kind, ...options] as Parameters<typeof original>);
    } as typeof original;
  });
  await page.goto('./');
  await expect(page.getByRole('alert')).toContainText('3D view unavailable');
  await page.getByRole('button', { name: 'Go to Outcome stage' }).click();
  await expect(page.locator('#metric-handler')).toHaveText('1');
  await page.getByRole('tab', { name: 'Inspector', exact: true }).click();
  await page.locator('[data-district="noul"]').click();
  await expect(page.locator('#district-code')).toContainText('response.nouls');
});