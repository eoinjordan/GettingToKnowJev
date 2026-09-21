import assert from 'node:assert/strict';
import test from 'node:test';
import { JevModel, evaluateGate, evaluationAt, scenarios } from './model.ts';

const finish = (model: JevModel) => { for (let index = 0; index < 8; index++) model.step(); return model.view(); };

test('three simultaneous questions consume one triage call', () => {
  const model = new JevModel();
  model.step(); model.step(); model.step();
  assert.deepEqual(model.view().active, ['choice', 'noul', 'score']);
  assert.equal(model.view().questionCalls, 1);
  assert.equal(model.view().routeCalls, 0);
  assert.equal(model.view().answersReady, false);
  model.step();
  assert.equal(model.view().answersReady, true);
});

test('normal flow records separate router and gate calls, never real tool execution', () => {
  const model = new JevModel();
  const view = finish(model);
  assert.equal(view.result, 'passed');
  assert.equal(view.totalCalls, 3);
  assert.equal(view.handlerCalls, 1);
  assert.ok(Math.abs(view.triage.severity - 1.9) < 1e-12);
  assert.equal(model.snapshot().realToolExecuted, false);
  model.step();
  assert.equal(model.view().tick, 8);
});

test('ambiguous answer abstains before route or tool calls', () => {
  const model = new JevModel();
  model.configure({ scenario: 'ambiguous' });
  const view = finish(model);
  assert.equal(view.result, 'review');
  assert.equal(view.totalCalls, 1);
  assert.equal(view.handlerCalls, 0);
});

test('high risk and classifier errors fail closed', () => {
  for (const scenario of ['high-risk', 'failure'] as const) {
    const model = new JevModel();
    model.configure({ scenario });
    assert.equal(finish(model).handlerCalls, 0);
    assert.equal(model.view().result, scenario === 'failure' ? 'error' : 'blocked');
  }
  assert.equal(evaluateGate({ listed: true, fails: false, risk: .5 }), 'blocked');
});

test('unlisted tool bypass is visible and does not call the risk classifier', () => {
  const model = new JevModel();
  model.configure({ scenario: 'unlisted' });
  const view = finish(model);
  assert.equal(view.result, 'bypass');
  assert.equal(view.gateCalls, 0);
  assert.equal(view.handlerCalls, 1);
});

test('policy adjustment resets a run and invalid updates preserve it', () => {
  const model = new JevModel();
  finish(model);
  const before = model.snapshot();
  assert.throws(() => model.configure({ confidenceFloor: Number.NaN }));
  assert.deepEqual(model.snapshot(), before);
  model.configure({ confidenceFloor: .95 });
  assert.equal(model.view().tick, 0);
  assert.equal(finish(model).result, 'review');
  model.reset();
  assert.equal(model.view().events.length, 0);
});

test('fixture distributions and all scenario state paths are valid', () => {
  for (const scenario of scenarios) {
    assert.ok(Math.abs(scenario.department.reduce((total, value) => total + value, 0) - 1) < 1e-9);
    assert.ok(Math.abs(scenario.severity.reduce((total, value) => total + value, 0) - 1) < 1e-9);
    assert.ok(scenario.severityConfidence >= 0 && scenario.severityConfidence <= 1);
    const model = new JevModel();
    model.configure({ scenario: scenario.id });
    const view = finish(model);
    assert.equal(view.events.length, 8);
    assert.ok(view.events.every(event => event.message.length));
    assert.ok(Number.isFinite(view.triage.severity));
  }
});

test('evaluation slider changes precision/recall but never Brier on fixed data', () => {
  const loose = evaluationAt(.8);
  const strict = evaluationAt(.95);
  assert.equal(loose.precision, .5);
  assert.equal(strict.precision, 1);
  assert.equal(strict.recall, 1 / 3);
  assert.equal(strict.falseNegative, 2);
  assert.ok(Math.abs(strict.brier - .18625) < 1e-12);
  assert.equal(loose.brier, strict.brier);
  assert.equal(evaluationAt(1).precision, null);
  assert.throws(() => evaluationAt(1.1));
});