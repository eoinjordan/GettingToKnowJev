export type ScenarioId = 'outage' | 'ambiguous' | 'routine' | 'high-risk' | 'failure' | 'unlisted';
export type DistrictId = 'state' | 'dispatch' | 'choice' | 'noul' | 'score' | 'policy' | 'router' | 'guard' | 'tool' | 'review';
export type Phase = 'ready' | 'state' | 'dispatch' | 'questions' | 'answers' | 'policy' | 'route' | 'gate' | 'complete';
export type Outcome = 'pending' | 'passed' | 'blocked' | 'review' | 'error' | 'bypass';

export interface Scenario {
  id: ScenarioId;
  name: string;
  state: string;
  department: [number, number, number];
  confidence: number;
  urgency: number;
  severity: [number, number, number];
  severityConfidence: number;
  modelRoute: 'fast' | 'powerful';
  risk: number;
  listed: boolean;
  fails: boolean;
}

export const scenarios: readonly Scenario[] = [
  { id: 'outage', name: 'Checkout outage', state: 'Checkout is unavailable for every customer. There is no workaround. Please investigate now.', department: [.92, .03, .05], confidence: .88, urgency: .96, severity: [0, .1, .9], severityConfidence: .85, modelRoute: 'powerful', risk: .1, listed: true, fails: false },
  { id: 'ambiguous', name: 'Ambiguous ticket', state: 'An order looks wrong. It might be a charge or a deployment issue; the report has no further details.', department: [.4, .3, .3], confidence: .1, urgency: .6, severity: [.2, .6, .2], severityConfidence: .3, modelRoute: 'powerful', risk: .3, listed: true, fails: false },
  { id: 'routine', name: 'Routine lookup', state: 'Read the current deployment version for checkout. No changes requested.', department: [.95, .02, .03], confidence: .93, urgency: .08, severity: [.95, .05, 0], severityConfidence: .93, modelRoute: 'fast', risk: .1, listed: true, fails: false },
  { id: 'high-risk', name: 'Risky proposed action', state: 'Investigate the checkout failure. The simulated agent proposes a write operation that has not been approved.', department: [.92, .03, .05], confidence: .88, urgency: .96, severity: [0, .1, .9], severityConfidence: .85, modelRoute: 'powerful', risk: .9, listed: true, fails: false },
  { id: 'failure', name: 'Classifier unavailable', state: 'Read the current checkout status. The tool-risk classifier returns a simulated service error.', department: [.92, .03, .05], confidence: .88, urgency: .8, severity: [0, .2, .8], severityConfidence: .7, modelRoute: 'fast', risk: .1, listed: true, fails: true },
  { id: 'unlisted', name: 'Unlisted tool', state: 'The simulated agent proposes a tool name that was not configured in AutoModeMiddleware.', department: [.92, .03, .05], confidence: .88, urgency: .6, severity: [0, .4, .6], severityConfidence: .4, modelRoute: 'fast', risk: .9, listed: false, fails: false },
];

export const phases: readonly Phase[] = ['ready', 'state', 'dispatch', 'questions', 'answers', 'policy', 'route', 'gate', 'complete'];

export interface Settings {
  scenario: ScenarioId;
  confidenceFloor: number;
  probabilityFloor: number;
  urgencyFloor: number;
}

export interface StepEvent {
  tick: number;
  phase: Phase;
  message: string;
}

function probability(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Probability must be within 0 and 1');
  return value;
}

export function evaluateTriage(scenario: Scenario, settings: Settings) {
  const labels = ['technical', 'billing', 'other'] as const;
  const selected = scenario.department.indexOf(Math.max(...scenario.department));
  const department = labels[selected]!;
  const needsReview = scenario.confidence < settings.confidenceFloor || scenario.department[selected]! < settings.probabilityFloor || department === 'other';
  return {
    department,
    probability: scenario.department[selected]!,
    destination: needsReview ? 'human_review' : department,
    priority: scenario.urgency >= settings.urgencyFloor ? 'immediate_review' : 'normal_review',
    severity: scenario.severity.reduce((total, weight, level) => total + weight * level, 0),
  };
}

export function evaluateGate(scenario: Pick<Scenario, 'listed' | 'fails' | 'risk'>): Exclude<Outcome, 'pending' | 'review'> {
  if (!scenario.listed) return 'bypass';
  if (scenario.fails) return 'error';
  return probability(scenario.risk) >= .5 ? 'blocked' : 'passed';
}

export function evaluationAt(threshold: number) {
  probability(threshold);
  const probabilities = [.95, .75, .85, .1, .4, .6];
  const labels = [1, 1, 0, 0, 0, 1];
  const cases = probabilities.map((value, index) => ({ probability: value, actual: labels[index]!, predicted: value >= threshold }));
  const truePositive = cases.filter(entry => entry.predicted && entry.actual === 1).length;
  const falsePositive = cases.filter(entry => entry.predicted && entry.actual === 0).length;
  const falseNegative = cases.filter(entry => !entry.predicted && entry.actual === 1).length;
  return {
    threshold, cases, truePositive, falsePositive, falseNegative,
    precision: truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : null,
    recall: truePositive / 3,
    brier: cases.reduce((total, entry) => total + (entry.probability - entry.actual) ** 2, 0) / cases.length,
  };
}

export class JevModel {
  settings: Settings = { scenario: 'outage', confidenceFloor: .7, probabilityFloor: .8, urgencyFloor: .8 };
  private tick = 0;
  private trace: StepEvent[] = [];

  configure(update: Partial<Settings>) {
    const candidate = { ...this.settings, ...update };
    if (!scenarios.some(scenario => scenario.id === candidate.scenario)) throw new RangeError('Unknown scenario');
    probability(candidate.confidenceFloor);
    probability(candidate.probabilityFloor);
    probability(candidate.urgencyFloor);
    this.settings = candidate;
    this.reset();
  }

  reset() {
    this.tick = 0;
    this.trace = [];
  }

  step() {
    if (this.tick >= phases.length - 1) return;
    this.tick += 1;
    const view = this.view();
    this.trace.push({ tick: this.tick, phase: view.phase, message: view.summary });
  }

  view() {
    const scenario = scenarios.find(entry => entry.id === this.settings.scenario)!;
    const phase = phases[this.tick]!;
    const triage = evaluateTriage(scenario, this.settings);
    const review = triage.destination === 'human_review';
    const result: Outcome = this.tick < 7 ? 'pending' : review ? 'review' : evaluateGate(scenario);
    const questionCalls = this.tick >= 2 ? 1 : 0;
    const routeCalls = this.tick >= 6 && !review ? 1 : 0;
    const gateCalls = this.tick >= 7 && !review && scenario.listed ? 1 : 0;
    const handlerCalls = this.tick >= 8 && (result === 'passed' || result === 'bypass') ? 1 : 0;
    const active: DistrictId[] = phase === 'state' ? ['state']
      : phase === 'dispatch' ? ['dispatch']
      : phase === 'questions' || phase === 'answers' ? ['choice', 'noul', 'score']
      : phase === 'policy' ? ['policy']
      : phase === 'route' ? [review ? 'review' : 'router']
      : phase === 'gate' ? [review ? 'review' : 'guard']
      : phase === 'complete' ? [result === 'passed' || result === 'bypass' ? 'tool' : 'review'] : ['state'];
    const summaries: Record<Phase, string> = {
      ready: 'Fixture ready', state: 'State captured', dispatch: 'One triage request dispatched',
      questions: 'Choice, Noul and Score evaluated against the same state', answers: 'Synthetic typed answers returned',
      policy: review ? 'Application policy abstains: human review' : `Triage route: ${triage.destination}`,
      route: review ? 'Model routing skipped pending review' : `Separate router fixture selects the ${scenario.modelRoute} model`,
      gate: review ? 'Tool gate skipped pending review' : result === 'bypass' ? 'Unlisted tool bypasses Auto Mode' : result === 'error' ? 'Risk classifier failed; handler not called' : result === 'blocked' ? 'Risk meets the fixed 0.5 cutoff; call blocked' : 'Risk below 0.5; recorded handler may proceed',
      complete: review ? 'Human review required' : result === 'blocked' ? 'Blocked: zero handler calls' : result === 'error' ? 'Fail-closed: zero handler calls' : result === 'bypass' ? 'Guard bypass: recording-only handler reached' : 'Recording-only handler completed',
    };
    return {
      tick: this.tick, phase, scenario, triage, result, active, summary: summaries[phase],
      answersReady: this.tick >= 4, complete: phase === 'complete', questionCalls, routeCalls, gateCalls, handlerCalls,
      totalCalls: questionCalls + routeCalls + gateCalls,
      events: this.trace.map(event => ({ ...event })),
    };
  }

  snapshot() {
    return {
      schema: 'getting-to-know-jev-city/v1',
      mode: 'offline deterministic teaching simulation',
      realModelCalled: false,
      realToolExecuted: false,
      scope: 'Predefined fixture answers; schematic flow and tick timing, not Jev internals, probabilities inferred from text, or measured latency. Routing and risk checks represent separate classifier requests. Unlisted-tool bypass models the pinned integration, not a recommended security policy.',
      settings: { ...this.settings },
      state: this.view(),
    };
  }
}