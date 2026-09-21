import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { preview } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'docs/media');
const width = 1280;
const height = 980;
const fps = 3;
const digest = content => createHash('sha256').update(content).digest('hex');

function execute(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

function checkPixels(buffer) {
  const image = PNG.sync.read(buffer);
  const colors = new Set();
  for (let offset = 0; offset < image.data.length; offset += 64) {
    colors.add(`${image.data[offset] >> 4},${image.data[offset + 1] >> 4},${image.data[offset + 2] >> 4}`);
  }
  assert.ok(colors.size > 40, 'City canvas must not be blank');
}

async function settle(page) {
  await page.evaluate(async () => {
    for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame);
    await document.fonts.ready;
  });
}

async function validateLayout(page) {
  const issues = await page.evaluate(() => {
    const problems = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) problems.push('page overflow');
    const scene = document.getElementById('scene');
    if (scene.dataset.framed !== '10' || scene.dataset.groundFramed !== 'true') problems.push('city not fully framed');
    for (const element of document.querySelectorAll('.answer, .metrics > div, .panel-section, .code-block')) {
      if (element.clientWidth && element.scrollWidth > element.clientWidth + 1) problems.push(element.className);
    }
    const boxes = [...document.querySelectorAll('.node-label')].filter(element => getComputedStyle(element).visibility === 'visible').map(element => element.getBoundingClientRect());
    for (const [index, first] of boxes.entries()) {
      if (boxes.slice(index + 1).some(second => first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top)) problems.push('labels overlap');
    }
    return problems;
  });
  assert.deepEqual(issues, []);
}

async function encode(frames, filename) {
  const child = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0',
    '-filter_complex', '[0:v]split[source][frames];[source]palettegen=max_colors=128:stats_mode=diff[palette];[frames][palette]paletteuse=dither=bayer:bayer_scale=3',
    '-loop', '0', filename,
  ], { cwd: root, stdio: ['pipe', 'ignore', 'pipe'] });
  const closed = once(child, 'close');
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  for (const frame of frames) {
    if (!child.stdin.write(frame)) await once(child.stdin, 'drain');
  }
  child.stdin.end();
  const [exitCode] = await closed;
  assert.equal(exitCode, 0, errors);
  const metadata = JSON.parse(execute('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_frames:format=duration,size', '-of', 'json', filename]));
  assert.equal(metadata.streams[0].width, width);
  assert.equal(metadata.streams[0].height, height);
  assert.equal(Number(metadata.streams[0].nb_read_frames), frames.length);
  return metadata;
}

console.log('Building the city for recording...');
execute('npm', ['run', 'build']);
await mkdir(output, { recursive: true });
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0 } });
const address = server.httpServer.address();
assert.ok(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const externalRequests = [];
const pageErrors = [];
const states = [];
const frames = [];
try {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
  page.on('request', request => { if (!request.url().startsWith(origin + '/')) externalRequests.push(request.url()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(origin);
  await page.locator('#scene[data-rendered="true"]').waitFor();
  await settle(page);
  checkPixels(await page.locator('#scene canvas').screenshot());

  async function capture(label, repeat = 3) {
    await settle(page);
    await validateLayout(page);
    const state = await page.locator('#app').evaluate(element => ({ ...element.dataset }));
    const image = await page.screenshot({ animations: 'disabled' });
    states.push({ label, ...state, screenshot_sha256: digest(image) });
    for (let index = 0; index < repeat; index++) frames.push(image);
  }

  await capture('Shared state ready');
  for (const stage of ['Dispatch', 'Questions', 'Answers', 'Policy', 'Route', 'Gate', 'Outcome']) {
    await page.getByRole('button', { name: `Go to ${stage} stage` }).click();
    await capture(stage);
  }
  await page.getByRole('tab', { name: 'Inspector', exact: true }).click();
  await page.locator('[data-district="choice"]').click();
  await page.getByRole('button', { name: 'Go to Answers stage' }).click();
  await capture('Choice inspector and typed response code');
  await page.screenshot({ path: resolve(output, 'city-desktop.png'), fullPage: true, animations: 'disabled' });

  for (const [scenario, expected] of [['ambiguous', 'review'], ['high-risk', 'blocked'], ['failure', 'error'], ['unlisted', 'bypass']]) {
    await page.getByRole('tab', { name: 'Experiment', exact: true }).click();
    await page.getByRole('combobox', { name: 'Scenario' }).selectOption(scenario);
    await page.getByRole('button', { name: 'Go to Outcome stage' }).click();
    assert.equal(await page.locator('#app').getAttribute('data-outcome'), expected);
    await capture(`${scenario}: ${expected}`);
  }
  await page.getByRole('tab', { name: 'Evaluation', exact: true }).click();
  await capture('Evaluation at 0.80: one true positive and one false positive');
  await page.getByLabel('Evaluation threshold', { exact: true }).evaluate(element => {
    element.value = '.95';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await page.locator('#precision').textContent(), '100%');
  assert.equal(await page.locator('#brier').textContent(), '0.18625');
  await capture('Evaluation at 0.95: Brier unchanged');

  const unique = new Set(frames.map(frame => digest(frame)));
  assert.ok(unique.size >= 12);
  const gif = resolve(output, 'jev-city.gif');
  const videoMetadata = await encode(frames, gif);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('combobox', { name: 'Scenario' }).selectOption('outage');
  await page.getByRole('button', { name: 'Go to Answers stage' }).click();
  await page.getByRole('tab', { name: 'Inspector', exact: true }).click();
  await page.locator('[data-district="choice"]').click();
  await page.getByRole('button', { name: 'Frame city', exact: true }).click();
  await page.evaluate(() => scrollTo(0, 0));
  await settle(page);
  await validateLayout(page);
  checkPixels(await page.locator('#scene canvas').screenshot());
  await page.screenshot({ path: resolve(output, 'city-mobile.png'), fullPage: true, animations: 'disabled' });
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(pageErrors, []);

  const sources = ['package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'src/app.ts', 'src/ui.css', 'src/districts.ts', 'src/world/city.ts', 'src/sim/model.ts', 'tools/record-city.mjs'];
  const sourceHashes = {};
  for (const source of sources) sourceHashes[source] = digest(await readFile(resolve(root, source)));
  const artifacts = {};
  for (const name of ['jev-city.gif', 'city-desktop.png', 'city-mobile.png']) {
    const content = await readFile(resolve(output, name));
    artifacts[name] = { bytes: content.length, sha256: digest(content) };
  }
  await writeFile(resolve(output, 'city-recording.json'), JSON.stringify({
    created_at: new Date().toISOString(), source_commit: execute('git', ['rev-parse', 'HEAD']).trim(),
    source_hashes: sourceHashes, build_index_sha256: digest(await readFile(resolve(root, 'dist/index.html'))),
    mode: 'Actual browser captures of the deterministic fixture simulation, not Jev inference or real-time performance.',
    viewport: { width, height }, fps, unique_frames: unique.size, video: videoMetadata, artifacts, states,
    external_requests: externalRequests, page_errors: pageErrors,
  }, null, 2) + '\n');
  console.log(`Recorded ${frames.length} frames / ${unique.size} distinct states, plus desktop/mobile screenshots.`);
} finally {
  await browser.close();
  await new Promise((resolveClose, reject) => {
    server.httpServer.close(error => error ? reject(error) : resolveClose());
    server.httpServer.closeAllConnections();
  });
}