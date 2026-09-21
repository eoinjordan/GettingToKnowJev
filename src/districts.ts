import type { DistrictId } from './sim/model';

export interface District {
  id: DistrictId;
  name: string;
  category: string;
  color: string;
  x: number;
  z: number;
  height: number;
  detail: string;
  code: string;
}

export const districts: readonly District[] = [
  { id: 'state', name: 'Shared state', category: 'Input', color: '#4c7e9e', x: -9, z: 3, height: 1.6,
    detail: 'The ticket and service context are data. They are not permission to execute an action. Every triage question receives this same state.',
    code: 'request = {\n    "state": STATE,\n    "questions": QUESTIONS,\n}\nresponse = classifier.invoke(request)' },
  { id: 'dispatch', name: 'One request', category: 'API boundary', color: '#566d7d', x: -8, z: -2, height: 1.2,
    detail: 'One TypeSafe request can contain several independent questions. The three-question fan-out here is a conceptual view of the documented interface, not a visualization of Jev kernels.',
    code: 'POST /v1/systemone\n{\n  "model": "jev-latest",\n  "state": {...},\n  "questions": {...}\n}' },
  { id: 'choice', name: 'Choice', category: 'Category distribution', color: '#158a7b', x: -3.2, z: -5.2, height: 2.8,
    detail: 'A Choice selects a label and returns a probability for each option. Its confidence is a separate summary of the distribution, not the winning probability or a guarantee of correctness.',
    code: 'answer = response.choices["department"]\nlabel = answer.choice\nprobability = answer.probabilities[label]\nconfidence = answer.confidence' },
  { id: 'noul', name: 'Noul', category: 'Truth probability', color: '#c4982b', x: -3.2, z: 0, height: 2.3,
    detail: 'A Noul answers a yes/no proposition with a probability in [0, 1]. It has no separate confidence field. The application decides how to use that probability.',
    code: 'urgent = response.nouls["urgent"].noul\npriority = (\n    "immediate_review" if urgent >= 0.8\n    else "normal_review"\n)' },
  { id: 'score', name: 'Score', category: 'Ordered rubric', color: '#d87856', x: -3.2, z: 5.2, height: 2.4,
    detail: 'A three-level rubric spans 0 to 2. Score is the probability-weighted position on those levels; dividing by two normalizes the position but does not turn it into a truth probability.',
    code: 'score = sum(\n    level * probability\n    for level, probability in distribution.items()\n)\nnormalized = score / (level_count - 1)' },
  { id: 'policy', name: 'Policy', category: 'Application code', color: '#327a91', x: 2, z: 0, height: 1.9,
    detail: 'Application thresholds determine when to route and when to abstain. The defaults match the Python triage lesson: confidence 0.70, selected probability 0.80, and urgency 0.80.',
    code: 'needs_review = (\n    confidence < confidence_floor\n    or selected_probability < probability_floor\n    or department == "other"\n)\nroute = "human_review" if needs_review else department' },
  { id: 'router', name: 'Model router', category: 'Separate classifier call', color: '#b55f7e', x: 6.3, z: -4.4, height: 3.1,
    detail: 'The pinned LangChain router classifies the latest human message once per run and keeps the chosen route. This city uses explicit fast/powerful fixtures, not live generative models.',
    code: 'response = classifier.invoke(route_request)\nanswer = response.choices["model_route"]\nstate["model_route"] = answer\nselected_model = models[answer.choice]\nhandler(request.override(model=selected_model))' },
  { id: 'guard', name: 'Tool gate', category: 'Auto Mode 0.0.1a3', color: '#597486', x: 7.2, z: 1.2, height: 1.8,
    detail: 'Configured tools are blocked at risk >= 0.5. Classifier failures do not invoke the handler. Unlisted tools bypass this particular middleware. Independent authorization is still required.',
    code: 'if tool_name not in configured_tools:\n    return handler(request)\nresponse = classifier.invoke(risk_request)\nprobability = response.nouls["is_risky"].noul\nif probability >= 0.5:\n    return blocked_tool_message\nreturn handler(request)' },
  { id: 'tool', name: 'Fixture tool', category: 'Recording-only handler', color: '#388c6c', x: 12, z: -2.1, height: 1.5,
    detail: 'The handler only records that it was reached. No shell command, file edit, network action or customer-system operation happens. A low-risk prediction is not authorization.',
    code: 'def handler(proposed_call):\n    calls.append(proposed_call.name)\n    return ToolMessage(\n        content="OFFLINE fixture status only"\n    )' },
  { id: 'review', name: 'Review / stop', category: 'No automatic action', color: '#b96150', x: 7, z: 6.3, height: 1.7,
    detail: 'Abstention, blocked calls and classifier errors reach a no-action outcome. This district is not an automatic human-approval implementation; it represents the boundary where the app must stop.',
    code: 'if uncertain:\n    return "human_review"\nif classified_risky:\n    return blocked_message\nif classifier_failed:\n    raise classification_error' },
];

export const districtById = (id: DistrictId) => districts.find(district => district.id === id)!;