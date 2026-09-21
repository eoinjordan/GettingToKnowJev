import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './ui.css';
import { Timer } from 'three';
import { createElement, Blocks, Play, Pause, SkipForward, RotateCcw, Focus, ZoomIn, ZoomOut, Download, BookOpen, ExternalLink, ChevronRight, Route, type IconNode } from 'lucide';
import { JevModel, evaluationAt, scenarios, type DistrictId, type ScenarioId, type Settings } from './sim/model';
import { districts, districtById } from './districts';
import { createCity } from './world/city';

const icon = (node: IconNode) => createElement(node, { width: '18', height: '18', 'aria-hidden': 'true', 'stroke-width': '1.7' }).outerHTML;
const tool = (id: string, label: string, node: IconNode) => `<button id="${id}" class="icon-button" type="button" aria-label="${label}" title="${label}">${icon(node)}</button>`;
const get = <Type extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as Type;
const model = new JevModel();
const app = get('app');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let running = !reduced.matches;
let selected: DistrictId = 'state';
let selectedTab = 'experiment';
let follow = true;
let speed = 1;
let remainder = 0;
let animationTime = 0;
let evaluationThreshold = .8;
let city: ReturnType<typeof createCity> | null = null;
let view = model.view();
const stageNames = ['Ready', 'State', 'Dispatch', 'Questions', 'Answers', 'Policy', 'Route', 'Gate', 'Outcome'];

app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="./">${icon(Blocks)}<div><h1>Jev City</h1><span>GettingToKnowJev</span></div></a>
    <div class="mode-mark"><i></i>OFFLINE FIXTURES</div>
    <nav aria-label="Project links">
      ${tool('tour', 'Follow the decision path', Route)}
      ${tool('export', 'Export simulation snapshot', Download)}
      <a class="icon-button" href="https://github.com/eoinjordan/GettingToKnowJev/blob/main/docs/walkthrough.md" target="_blank" rel="noreferrer" title="Read the walkthrough" aria-label="Read the walkthrough">${icon(BookOpen)}</a>
      <a class="icon-button" href="https://github.com/eoinjordan/GettingToKnowJev" target="_blank" rel="noreferrer" title="Source repository" aria-label="Source repository">${icon(ExternalLink)}</a>
    </nav>
  </header>
  <div class="scope-strip"><span>Deterministic teaching model</span><span>No live Jev inference</span><span>No real tool execution</span></div>
  <main class="workspace">
    <section class="primary" aria-label="Decision city">
      <div class="workbar"><div><p class="eyebrow">DECISION FLOW</p><h2 id="scenario-title"></h2></div><label class="scenario-field"><span class="sr-only">Scenario</span><select id="scenario" aria-label="Scenario">${scenarios.map(scenario => `<option value="${scenario.id}">${scenario.name}</option>`).join('')}</select></label></div>
      <div class="metrics">
        <div><span>Modelled calls</span><strong id="metric-calls">0</strong><small id="call-breakdown">triage / router / risk</small></div>
        <div><span>Typed answers</span><strong id="metric-answers">0 / 3</strong><small>Choice / Noul / Score</small></div>
        <div><span>Policy route</span><strong class="word-value" id="metric-route">Pending</strong><small id="metric-priority">not evaluated</small></div>
        <div><span>Fixture handler</span><strong id="metric-handler">0</strong><small>recorded invocations</small></div>
      </div>
      <div class="viewport">
        <div id="scene"></div>
        <div class="view-switch" role="group" aria-label="Camera view"><button type="button" data-camera="iso" aria-pressed="true">City</button><button type="button" data-camera="plan" aria-pressed="false">Plan</button></div>
        <div class="camera-tools">${tool('frame', 'Frame city', Focus)}${tool('zoom-in', 'Zoom in', ZoomIn)}${tool('zoom-out', 'Zoom out', ZoomOut)}</div>
        <div class="scene-key"><span><i class="key-state"></i>state</span><span><i class="key-question"></i>questions</span><span><i class="key-policy"></i>application policy</span><span><i class="key-outcome"></i>outcome</span></div>
      </div>
      <div class="transport"><div>${tool('play', 'Pause flow', Pause)}${tool('step', 'Step flow', SkipForward)}${tool('reset', 'Reset flow', RotateCcw)}<span id="tick">00 / 08</span></div><label class="speed"><span>Playback</span><input id="speed" type="range" min="0.5" max="2" step="0.25" value="1" aria-label="Playback speed"><output id="speed-value">1.00x</output></label><span id="run-state">Running</span></div>
      <nav class="stage-rail" aria-label="Decision stages">${stageNames.map((name, index) => `<button type="button" data-stage="${index}" aria-label="Go to ${name} stage" aria-current="${index === 0 ? 'step' : 'false'}"><span>${String(index).padStart(2, '0')}</span>${name}</button>`).join('')}</nav>
      <div class="outcome" id="outcome"><i></i><strong id="summary"></strong><span id="outcome-code">READY</span></div>
      <section class="answers-band" aria-label="Typed answers">
        <article class="answer answer-choice"><button class="answer-heading" type="button" data-inspect="choice"><span><i></i>Choice</span>${icon(ChevronRight)}</button><div class="answer-main"><strong id="choice-value">Pending</strong><span id="choice-confidence">confidence --</span></div><div id="choice-bars" class="probability-bars"></div><small>Category probabilities</small></article>
        <article class="answer answer-noul"><button class="answer-heading" type="button" data-inspect="noul"><span><i></i>Noul</span>${icon(ChevronRight)}</button><div class="answer-main"><strong id="noul-value">Pending</strong><span>p(urgent)</span></div><div id="noul-bars" class="probability-bars"></div><small>Truth probability; no confidence field</small></article>
        <article class="answer answer-score"><button class="answer-heading" type="button" data-inspect="score"><span><i></i>Score</span>${icon(ChevronRight)}</button><div class="answer-main"><strong id="score-value">Pending</strong><span id="score-normalized">normalized --</span><span id="score-confidence">confidence --</span></div><div id="score-bars" class="probability-bars"></div><small>Ordered levels; weighted mean</small></article>
      </section>
    </section>
    <aside>
      <div class="tabs" role="tablist" aria-label="Lab panels">${['experiment', 'inspector', 'evaluation'].map((name, index) => `<button id="tab-${name}" type="button" role="tab" aria-controls="panel-${name}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${['Experiment', 'Inspector', 'Evaluation'][index]}</button>`).join('')}</div>
      <div id="panel-experiment" role="tabpanel" aria-labelledby="tab-experiment">
        <section class="panel-section"><div class="section-heading"><h3>Fixture state</h3><span class="tag">SYNTHETIC</span></div><p id="fixture-state" class="state-text"></p><div class="call-ledger"><span>Triage request<strong id="ledger-triage">0</strong></span><span>Model routing<strong id="ledger-router">0</strong></span><span>Tool-risk check<strong id="ledger-risk">0</strong></span></div></section>
        <section class="panel-section"><h3>Application thresholds</h3>${[
          ['confidenceFloor', 'Choice confidence floor', .7], ['probabilityFloor', 'Selected probability floor', .8], ['urgencyFloor', 'Immediate-review threshold', .8],
        ].map(([key, title, value]) => `<label class="range-field"><span>${title}<output id="value-${key}">${Number(value).toFixed(2)}</output></span><input id="control-${key}" type="range" min="0" max="1" step="0.05" value="${value}" aria-label="${title}"></label>`).join('')}<div class="fixed-rule"><span>Auto Mode cutoff</span><strong>risk &gt;= 0.50</strong></div></section>
        <section class="panel-section"><h3>Event ledger</h3><ol id="events" class="events"></ol></section>
      </div>
      <div id="panel-inspector" role="tabpanel" aria-labelledby="tab-inspector" hidden>
        <section class="panel-section"><label class="follow"><input id="follow" type="checkbox" checked><span>Follow active district</span></label><p id="district-category" class="eyebrow"></p><h2 id="district-name"></h2><p id="district-detail" class="detail"></p><pre class="code-block"><code id="district-code"></code></pre><a class="source-link" href="https://github.com/eoinjordan/GettingToKnowJev/blob/main/walkthrough.py" target="_blank" rel="noreferrer">Python reference ${icon(ExternalLink)}</a></section>
        <section class="panel-section"><h3>Districts</h3><div class="district-index">${districts.map(district => `<button type="button" data-district="${district.id}" aria-pressed="false"><i style="background:${district.color}"></i><span>${district.name}</span>${icon(ChevronRight)}</button>`).join('')}</div></section>
      </div>
      <div id="panel-evaluation" role="tabpanel" aria-labelledby="tab-evaluation" hidden>
        <section class="panel-section"><div class="section-heading"><h3>Six labeled fixtures</h3><span class="tag">NOT MODEL EVALS</span></div><label class="range-field"><span>Positive threshold<output id="evaluation-threshold-value">0.80</output></span><input id="evaluation-threshold" type="range" min="0" max="1" step="0.05" value="0.8" aria-label="Evaluation threshold"></label><div class="evaluation-metrics"><div><span>Precision</span><strong id="precision"></strong></div><div><span>Recall</span><strong id="recall"></strong></div><div><span>Brier score</span><strong id="brier"></strong></div></div><div class="confusion"><span>TP <strong id="true-positive"></strong></span><span>FP <strong id="false-positive"></strong></span><span>FN <strong id="false-negative"></strong></span></div><table class="evaluation-table"><thead><tr><th>Case</th><th>Probability</th><th>Actual</th><th>Result</th></tr></thead><tbody id="evaluation-cases"></tbody></table><p class="detail evaluation-note">Fixed probabilities and labels. The threshold changes flags, not Brier score.</p></section>
      </div>
      <footer class="boundary"><span class="tag">INTERFACE MODEL</span><p>Predefined answers. Schematic flow, not Jev internals or measured latency. Authorization remains an independent application boundary.</p></footer>
    </aside>
  </main>
  <div class="notice" id="notice" role="status" aria-live="polite"></div>`;

function setTab(name: string) {
  selectedTab = name;
  for (const tab of ['experiment', 'inspector', 'evaluation']) {
    get(`panel-${tab}`).hidden = tab !== name;
    get(`tab-${tab}`).setAttribute('aria-selected', String(tab === name));
    get(`tab-${tab}`).tabIndex = tab === name ? 0 : -1;
  }
}

function inspect(id: DistrictId, reveal = false) {
  selected = id;
  const district = districtById(id);
  get('district-category').textContent = district.category;
  get('district-name').textContent = district.name;
  get('district-detail').textContent = district.detail;
  get('district-code').textContent = district.code;
  get('district-name').style.color = district.color;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-district]')) button.setAttribute('aria-pressed', String(button.dataset.district === id));
  city?.select(id);
  if (reveal) setTab('inspector');
}

function barRows(id: string, labels: string[]) {
  get(id).innerHTML = labels.map((label, index) => `<div><span>${label}</span><progress id="${id}-${index}" max="1" value="0" aria-label="${label} probability"></progress><output id="${id}-${index}-value">--</output></div>`).join('');
}
barRows('choice-bars', ['Technical', 'Billing', 'Other']);
barRows('noul-bars', ['True', 'False']);
barRows('score-bars', ['Cosmetic', 'Workaround', 'Blocked']);

function updateBars(id: string, values: readonly number[]) {
  values.forEach((value, index) => {
    get<HTMLProgressElement>(`${id}-${index}`).value = view.answersReady ? value : 0;
    get(`${id}-${index}-value`).textContent = view.answersReady ? value.toFixed(2) : '--';
  });
}

function refreshEvaluation() {
  const evaluation = evaluationAt(evaluationThreshold);
  get('evaluation-threshold-value').textContent = evaluationThreshold.toFixed(2);
  get('precision').textContent = evaluation.precision === null ? 'n/a' : `${(evaluation.precision * 100).toFixed(0)}%`;
  get('recall').textContent = `${(evaluation.recall * 100).toFixed(0)}%`;
  get('brier').textContent = evaluation.brier.toFixed(5);
  get('true-positive').textContent = String(evaluation.truePositive);
  get('false-positive').textContent = String(evaluation.falsePositive);
  get('false-negative').textContent = String(evaluation.falseNegative);
  get('evaluation-cases').innerHTML = evaluation.cases.map((entry, index) => {
    const result = entry.predicted ? entry.actual ? 'TP' : 'FP' : entry.actual ? 'FN' : 'TN';
    return `<tr data-result="${result}"><td>${String(index + 1).padStart(2, '0')}</td><td>${entry.probability.toFixed(2)}</td><td>${entry.actual}</td><td><span>${result}</span></td></tr>`;
  }).join('');
}

function refresh() {
  view = model.view();
  app.dataset.phase = view.phase;
  app.dataset.scenario = view.scenario.id;
  app.dataset.outcome = view.result;
  app.dataset.tick = String(view.tick);
  get('scenario-title').textContent = view.scenario.name;
  get<HTMLSelectElement>('scenario').value = view.scenario.id;
  get('metric-calls').textContent = String(view.totalCalls);
  get('call-breakdown').textContent = `${view.questionCalls} triage / ${view.routeCalls} router / ${view.gateCalls} risk`;
  get('metric-answers').textContent = `${view.answersReady ? 3 : 0} / 3`;
  get('metric-route').textContent = view.tick < 5 ? 'Pending' : view.triage.destination === 'human_review' ? 'Review' : 'Technical';
  get('metric-priority').textContent = view.tick < 5 ? 'not evaluated' : view.triage.priority.replaceAll('_', ' ');
  get('metric-handler').textContent = String(view.handlerCalls);
  get('ledger-triage').textContent = String(view.questionCalls);
  get('ledger-router').textContent = String(view.routeCalls);
  get('ledger-risk').textContent = String(view.gateCalls);
  get('fixture-state').textContent = view.scenario.state;
  get('summary').textContent = view.summary;
  get('outcome').dataset.result = view.result;
  get('outcome-code').textContent = view.result === 'pending' ? view.phase.toUpperCase() : view.result.toUpperCase();
  get('tick').textContent = `${String(view.tick).padStart(2, '0')} / 08`;
  get('run-state').textContent = running ? 'Running' : view.complete ? 'Complete' : 'Paused';
  const playLabel = running ? 'Pause flow' : view.complete ? 'Replay flow' : 'Play flow';
  get('play').innerHTML = icon(running ? Pause : Play);
  get('play').setAttribute('aria-label', playLabel);
  get('play').title = playLabel;
  get<HTMLButtonElement>('step').disabled = view.complete;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-stage]')) {
    button.setAttribute('aria-current', Number(button.dataset.stage) === view.tick ? 'step' : 'false');
    button.dataset.past = String(Number(button.dataset.stage) < view.tick);
  }
  get('choice-value').textContent = view.answersReady ? view.triage.department : 'Pending';
  get('choice-confidence').textContent = `confidence ${view.answersReady ? view.scenario.confidence.toFixed(2) : '--'}`;
  get('noul-value').textContent = view.answersReady ? view.scenario.urgency.toFixed(2) : 'Pending';
  get('score-value').textContent = view.answersReady ? `${view.triage.severity.toFixed(2)} / 2` : 'Pending';
  get('score-normalized').textContent = `normalized ${view.answersReady ? (view.triage.severity / 2).toFixed(2) : '--'}`;
  get('score-confidence').textContent = `confidence ${view.answersReady ? view.scenario.severityConfidence.toFixed(2) : '--'}`;
  updateBars('choice-bars', view.scenario.department);
  updateBars('noul-bars', [view.scenario.urgency, 1 - view.scenario.urgency]);
  updateBars('score-bars', view.scenario.severity);
  get('events').replaceChildren(...(view.events.length ? view.events : [{ tick: 0, phase: 'ready', message: 'Scenario loaded; no classifier request made.' }]).map(event => {
    const item = document.createElement('li');
    const count = document.createElement('span');
    count.textContent = String(event.tick).padStart(2, '0');
    const text = document.createElement('span');
    text.textContent = event.message;
    item.append(count, text);
    return item;
  }));
  for (const key of ['confidenceFloor', 'probabilityFloor', 'urgencyFloor'] as const) {
    get<HTMLInputElement>(`control-${key}`).value = String(model.settings[key]);
    get(`value-${key}`).textContent = model.settings[key].toFixed(2);
  }
  if (follow && !view.active.includes(selected)) selected = view.active[0]!;
  city?.update(view);
  inspect(selected);
}

try { city = createCity(get('scene'), id => { follow = false; get<HTMLInputElement>('follow').checked = false; inspect(id, true); }); }
catch { get('scene').innerHTML = '<div class="fallback" role="alert"><strong>3D view unavailable</strong><span>State controls, typed answers and the inspector remain active.</span></div>'; get('scene').dataset.fallback = 'true'; }

get<HTMLSelectElement>('scenario').addEventListener('change', event => {
  model.configure({ scenario: (event.target as HTMLSelectElement).value as ScenarioId });
  remainder = animationTime = 0;
  get('notice').textContent = '';
  refresh();
});
get('play').addEventListener('click', () => {
  if (view.complete) { model.reset(); animationTime = 0; }
  running = !running;
  remainder = 0;
  refresh();
});
get('step').addEventListener('click', () => { running = false; remainder = 0; model.step(); animationTime += .9; refresh(); });
get('reset').addEventListener('click', () => { model.reset(); running = false; remainder = animationTime = 0; refresh(); });
get('speed').addEventListener('input', event => { speed = Number((event.target as HTMLInputElement).value); get('speed-value').textContent = `${speed.toFixed(2)}x`; });
get('frame').addEventListener('click', () => city?.frame());
get('zoom-in').addEventListener('click', () => city?.zoom(1));
get('zoom-out').addEventListener('click', () => city?.zoom(-1));
get('follow').addEventListener('change', event => { follow = (event.target as HTMLInputElement).checked; refresh(); });
get('tour').addEventListener('click', () => { follow = true; get<HTMLInputElement>('follow').checked = true; setTab('inspector'); model.reset(); running = !reduced.matches; remainder = animationTime = 0; refresh(); });
get('evaluation-threshold').addEventListener('input', event => { evaluationThreshold = Number((event.target as HTMLInputElement).value); refreshEvaluation(); });
for (const key of ['confidenceFloor', 'probabilityFloor', 'urgencyFloor'] as const) get(`control-${key}`).addEventListener('input', event => {
  try {
    model.configure({ [key]: Number((event.target as HTMLInputElement).value) } as Partial<Settings>);
    running = false; remainder = animationTime = 0; refresh();
  } catch { get('notice').textContent = 'Invalid threshold; previous state retained.'; }
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-stage]')) button.addEventListener('click', () => {
  model.reset();
  for (let step = 0; step < Number(button.dataset.stage); step++) model.step();
  running = false; remainder = 0; animationTime = model.view().tick * .9; refresh();
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-camera]')) button.addEventListener('click', () => {
  for (const other of document.querySelectorAll('[data-camera]')) other.setAttribute('aria-pressed', String(other === button));
  city?.setView(button.dataset.camera as 'iso' | 'plan');
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-district], [data-inspect]')) button.addEventListener('click', () => {
  follow = false; get<HTMLInputElement>('follow').checked = false;
  inspect((button.dataset.district || button.dataset.inspect) as DistrictId, true);
});
const tabs = ['experiment', 'inspector', 'evaluation'];
for (const [index, name] of tabs.entries()) {
  const tab = get(`tab-${name}`);
  tab.addEventListener('click', () => setTab(name));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
    setTab(tabs[next]!); get(`tab-${selectedTab}`).focus();
  });
}
get('export').addEventListener('click', () => {
  const snapshot = { ...model.snapshot(), evaluation: { mode: 'six synthetic labeled cases', ...evaluationAt(evaluationThreshold) } };
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'jev-city-fixture.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  get('notice').textContent = 'Offline fixture snapshot exported.';
});

const timer = new Timer();
timer.connect(document);
const visibility = () => { remainder = 0; };
document.addEventListener('visibilitychange', visibility);
const motion = () => { if (reduced.matches) { running = false; remainder = 0; refresh(); } };
reduced.addEventListener('change', motion);
let animationId = 0;
function animate(timestamp: number) {
  animationId = requestAnimationFrame(animate);
  timer.update(timestamp);
  const delta = Math.max(0, Math.min(timer.getDelta(), .15));
  if (running && !document.hidden) {
    remainder += delta * speed;
    animationTime += delta * speed;
    if (remainder >= .9) {
      remainder -= .9;
      model.step();
      if (model.view().complete) running = false;
      refresh();
    }
  }
  city?.render(animationTime);
}
refreshEvaluation(); refresh();
animationId = requestAnimationFrame(animate);
if (import.meta.hot) import.meta.hot.dispose(() => {
  cancelAnimationFrame(animationId); timer.dispose(); city?.dispose();
  document.removeEventListener('visibilitychange', visibility);
  reduced.removeEventListener('change', motion);
});