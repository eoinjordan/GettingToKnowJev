"""GettingToKnowJev: offline contract lessons and explicitly opted-in API calls."""

import argparse
import asyncio
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import statistics
import sys
import time
from types import SimpleNamespace
from unittest.mock import patch

os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"

import httpx2
from langchain_typesafe import Choice, Noul, Score, TypeSafeClassifier


ROOT = Path(__file__).resolve().parent
API_BASE = "https://api.typesafe.ai"
STATE = {
    "ticket": "Our checkout deployment fails for every customer. The old version is also unavailable. Please investigate now.",
    "service": "checkout",
}
QUESTIONS = {
    "department": Choice(
        instructions="Which team should investigate the stated problem?",
        criteria={"technical": "Product or deployment malfunction", "billing": "Invoices or charges", "other": "Neither category fits"},
    ),
    "urgent": Noul(instructions="Does the stated situation need immediate attention because service is currently unavailable?"),
    "severity": Score(
        instructions="How much does this problem prevent using the service?",
        criteria=["Cosmetic issue; service remains usable", "A feature fails but an available workaround exists", "Service is blocked with no stated workaround"],
    ),
}
FIXTURE = {
    "model": "OFFLINE-FIXTURE-NOT-JEV-INFERENCE",
    "answers": {
        "department": {"type": "choice", "choice": "technical", "probabilities": {"technical": 0.92, "billing": 0.03, "other": 0.05}, "confidence": 0.88},
        "urgent": {"type": "noul", "noul": 0.96},
        "severity": {"type": "score", "score": 1.9, "probabilities": {"0": 0.0, "1": 0.1, "2": 0.9},
                     "legend": {"0": "Cosmetic", "1": "Workaround exists", "2": "Blocked"}, "confidence": 0.85},
    },
    "usage": {"input_tokens": 0, "output_tokens": 0},
}


@contextmanager
def offline_classifier(body=FIXTURE, status=200):
    captured = []

    def respond(request):
        if request.url.host != "api.typesafe.ai" or request.url.path != "/v1/systemone":
            raise AssertionError("Unexpected endpoint")
        captured.append(json.loads(request.content))
        return httpx2.Response(status, json=deepcopy(body), headers={"x-request-id": "offline-fixture"})

    transport = httpx2.MockTransport(respond)
    client = httpx2.Client(transport=transport, trust_env=False)
    async_client = httpx2.AsyncClient(transport=transport, trust_env=False)
    classifier = TypeSafeClassifier(api_key="offline-fixture-not-a-secret", base_url=API_BASE, client=client, async_client=async_client)
    try:
        yield classifier, captured
    finally:
        client.close()
        asyncio.run(async_client.aclose())


def probability(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError("Probability must be a finite number in [0, 1]")
    return float(value)


def triage_policy(response):
    department = response.choices["department"]
    expected = set(QUESTIONS["department"].criteria)
    if set(department.probabilities) != expected or department.choice not in expected:
        raise ValueError("Unexpected department labels")
    distribution = {label: probability(value) for label, value in department.probabilities.items()}
    if not math.isclose(sum(distribution.values()), 1.0, abs_tol=0.001):
        raise ValueError("Choice distribution must sum to one")
    if distribution[department.choice] < max(distribution.values()):
        raise ValueError("Chosen department is not a maximum-probability option")
    severity = response.scores["severity"]
    top_level = len(QUESTIONS["severity"].criteria) - 1
    if set(severity.probabilities) != set(range(top_level + 1)):
        raise ValueError("Unexpected severity levels")
    levels = {level: probability(value) for level, value in severity.probabilities.items()}
    if not math.isclose(sum(levels.values()), 1.0, abs_tol=0.001):
        raise ValueError("Score distribution must sum to one")
    expected_score = sum(level * weight for level, weight in levels.items())
    if not math.isfinite(severity.score) or not math.isclose(severity.score, expected_score, abs_tol=0.02):
        raise ValueError("Score does not agree with its distribution")
    confidence = probability(department.confidence)
    urgency = probability(response.nouls["urgent"].noul)
    review = confidence < 0.7 or distribution[department.choice] < 0.8 or department.choice == "other"
    return {
        "route": "human_review" if review else department.choice,
        "priority": "immediate_review" if urgency >= 0.8 else "normal_review",
        "urgency_probability": urgency,
        "department_confidence": confidence,
        "severity_normalized": severity.score / top_level,
        "scope": "Illustrative policy thresholds, not calibrated production cutoffs. No ticket is actually assigned or modified.",
    }


def demo():
    with offline_classifier() as (classifier, captured):
        response = classifier.invoke({"state": STATE, "questions": QUESTIONS})
        uncertain = deepcopy(FIXTURE)
        uncertain["answers"]["department"].update(
            choice="technical", probabilities={"technical": 0.4, "billing": 0.3, "other": 0.3}, confidence=0.1,
        )
        with offline_classifier(uncertain) as (other_classifier, _):
            other = other_classifier.invoke({"state": STATE, "questions": QUESTIONS})
        return {
            "mode": "offline_http_fixture", "real_model_called": False,
            "serialized_request": captured[0], "typed_response": response.model_dump(),
            "clear_case_policy": triage_policy(response), "uncertain_case_policy": triage_policy(other),
            "scope": "Actual LangChain serialization and answer parsing, synthetic answers. Zero network calls and no latency/quality claim.",
        }


def routing_demo():
    from langchain.agents import create_agent
    from langchain_core.language_models.fake_chat_models import FakeListChatModel
    from langchain_core.messages import HumanMessage
    from langchain_typesafe.experimental.middleware import ModelChoice, ModelRouterMiddleware

    body = {"model": FIXTURE["model"], "answers": {
        "model_route": {"type": "choice", "choice": "fast", "probabilities": {"fast": 0.9, "powerful": 0.1}, "confidence": 0.8},
    }}
    fast = FakeListChatModel(responses=["OFFLINE: fast fake chat model selected."])
    powerful = FakeListChatModel(responses=["OFFLINE: powerful fake chat model selected."])
    with offline_classifier(body) as (classifier, captured), patch(
        "langchain_typesafe.experimental.middleware.model_router.TypeSafeClassifier", return_value=classifier,
    ):
        router = ModelRouterMiddleware(
            choices={"fast": ModelChoice(model=fast, criteria="Simple bounded lookup"),
                     "powerful": ModelChoice(model=powerful, criteria="Complex analysis requiring more reasoning")},
            instructions="Choose the least costly suitable route.",
        )
        agent = create_agent(fast, middleware=[router])
        result = agent.invoke({"messages": [HumanMessage("Show the current deployment version.")]})
    answer = result["model_route"]
    return {"mode": "offline_real_middleware_fake_models", "classifier_calls": len(captured),
            "route_answer": answer.model_dump(), "message": result["messages"][-1].content,
            "scope": "The pinned router selects once from the latest human message, then keeps that route for the run. It does not itself add a low-confidence human-review policy."}


def tool_gate_case(risk, tool_name="lookup_status", fail=False):
    from langchain_core.messages import HumanMessage, ToolMessage
    from langchain_typesafe.experimental.middleware import AutoModeMiddleware

    body = {"model": FIXTURE["model"], "answers": {"is_risky": {"type": "noul", "noul": risk}}}
    calls = []
    request = SimpleNamespace(tool_call={"id": "fixture-call", "name": tool_name, "args": {"service": "checkout"}},
                              state={"messages": [HumanMessage("Read the status of the checkout service.")]}, tool=None)

    def handler(proposed):
        calls.append(proposed.tool_call["name"])
        return ToolMessage(content="OFFLINE fixture status only", tool_call_id="fixture-call")

    with offline_classifier(body, status=503 if fail else 200) as (classifier, captured), patch(
        "langchain_typesafe.experimental.middleware.auto_mode.TypeSafeClassifier", return_value=classifier,
    ):
        guard = AutoModeMiddleware(tools=["lookup_status"])
        try:
            result = guard.wrap_tool_call(request, handler)
            outcome = {"status": result.status, "message": result.content}
        except Exception as error:
            outcome = {"status": "classification_error", "error_type": type(error).__name__}
    return {"tool": tool_name, "fixture_risk": risk, "classifier_calls": len(captured),
            "handler_calls": len(calls), **outcome}


def gate_demo():
    return {
        "mode": "offline_real_middleware_recording_only_handler",
        "cases": [tool_gate_case(0.1), tool_gate_case(0.5), tool_gate_case(0.9),
                  tool_gate_case(0.1, fail=True), tool_gate_case(0.9, tool_name="unlisted_fixture")],
        "scope": "No shell, filesystem or remote tool executes. Configured tools block at risk >= 0.5; classifier failures do not invoke the handler. Unlisted tools bypass this middleware. A classifier is not a sandbox or authorization boundary.",
    }


def calibration_metrics(predictions, labels, threshold=0.8):
    if not predictions or len(predictions) != len(labels) or any(label not in (0, 1) for label in labels):
        raise ValueError("Supply equally sized nonempty probabilities and binary labels")
    predictions = [probability(value) for value in predictions]
    threshold = probability(threshold)
    selected = [value >= threshold for value in predictions]
    true_positive = sum(predicted and label == 1 for predicted, label in zip(selected, labels))
    false_positive = sum(predicted and label == 0 for predicted, label in zip(selected, labels))
    false_negative = sum(not predicted and label == 1 for predicted, label in zip(selected, labels))
    return {"samples": len(labels), "threshold": threshold,
            "brier_score": statistics.mean((value - label) ** 2 for value, label in zip(predictions, labels)),
            "precision": true_positive / (true_positive + false_positive) if true_positive + false_positive else None,
            "recall": true_positive / (true_positive + false_negative) if true_positive + false_negative else None,
            "false_positives": false_positive, "false_negatives": false_negative}


def evaluation_demo():
    predictions = [0.95, 0.75, 0.85, 0.1, 0.4, 0.6]
    labels = [1, 1, 0, 0, 0, 1]
    return {"mode": "synthetic_probability_fixture_not_model_evaluation", "predictions": predictions, "labels": labels,
            "thresholds": [calibration_metrics(predictions, labels, threshold) for threshold in (0.5, 0.8, 0.95)],
            "scope": "Demonstrates metric arithmetic only. Evaluate held-out domain labels before claiming calibration, accuracy, latency or savings."}


def live_classification(args):
    if not args.confirm_live:
        raise ValueError("Live mode sends state to TypeSafe and may incur charges. Add --confirm-live to opt in.")
    key = os.environ.get("TYPESAFE_API_KEY", "")
    if not key.strip():
        raise ValueError("Set TYPESAFE_API_KEY in your terminal; do not paste it into chat or commit it.")
    with httpx2.Client(timeout=20, trust_env=False) as client:
        async_client = httpx2.AsyncClient(timeout=20, trust_env=False)
        try:
            classifier = TypeSafeClassifier(api_key=key, base_url=API_BASE, model=args.model, client=client, async_client=async_client)
            started = time.perf_counter()
            response = classifier.invoke({"state": STATE, "questions": QUESTIONS})
            elapsed = time.perf_counter() - started
        finally:
            asyncio.run(async_client.aclose())
    return {"mode": "live_typesafe_api", "requested_model": args.model, "resolved_model": response.model,
            "client_wall_seconds": elapsed, "request_id": response.request_id,
            "response": response.model_dump(), "policy": triage_policy(response),
            "scope": "One real request with the bundled synthetic ticket. End-to-end network latency, not isolated inference time. No tool or chat-model call follows."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("demo", "routing", "gate", "eval", "all", "live"), nargs="?", default="demo")
    parser.add_argument("--confirm-live", action="store_true")
    parser.add_argument("--model", default="jev-latest")
    parser.add_argument("--save", action="store_true", help="Save the report under ignored results/")
    args = parser.parse_args()
    try:
        actions = {"demo": demo, "routing": routing_demo, "gate": gate_demo, "eval": evaluation_demo}
        if args.action == "all":
            result = {name: function() for name, function in actions.items()}
        elif args.action == "live":
            result = live_classification(args)
        else:
            result = actions[args.action]()
        report = {"created_at": datetime.now(timezone.utc).isoformat(), "result": result}
        print(json.dumps(report, indent=2, allow_nan=False))
        if args.save:
            directory = ROOT / "results"
            directory.mkdir(exist_ok=True)
            path = directory / f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}-{args.action}.json"
            path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
            print(f"Saved {path}")
        return 0
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1
    except Exception as error:
        print(f"Request or walkthrough failed ({type(error).__name__}); no automatic tool action was taken.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())