import asyncio
from copy import deepcopy
import json
import math
import os
import unittest
from unittest.mock import patch

from langchain_core.messages import HumanMessage
from langchain_typesafe import ClassifierResponse

import walkthrough


class OfflineTests(unittest.TestCase):
    def test_actual_http_serialization_and_typed_answers(self):
        with patch("socket.socket.connect", side_effect=AssertionError("Network forbidden")):
            report = walkthrough.demo()
        self.assertFalse(report["real_model_called"])
        self.assertEqual(report["serialized_request"]["model"], "jev-latest")
        self.assertEqual(set(report["serialized_request"]["questions"]), {"department", "urgent", "severity"})
        self.assertEqual(report["clear_case_policy"]["route"], "technical")
        self.assertEqual(report["uncertain_case_policy"]["route"], "human_review")
        self.assertAlmostEqual(report["clear_case_policy"]["severity_normalized"], 0.95)

    def test_messages_are_serialized_and_async_uses_mock_transport(self):
        with walkthrough.offline_classifier() as (classifier, captured):
            result = asyncio.run(classifier.ainvoke({"state": {"messages": [HumanMessage("Example input")]}, "questions": walkthrough.QUESTIONS}))
        self.assertEqual(result.nouls["urgent"].noul, 0.96)
        self.assertEqual(captured[0]["state"]["messages"][0]["role"], "user")

    def test_fixture_key_is_not_in_serialized_classifier(self):
        with walkthrough.offline_classifier() as (classifier, _):
            self.assertNotIn("offline-fixture-not-a-secret", classifier.model_dump_json())

    def test_router_runs_once_and_uses_the_selected_fake_model(self):
        with patch("socket.socket.connect", side_effect=AssertionError("Network forbidden")):
            result = walkthrough.routing_demo()
        self.assertEqual(result["classifier_calls"], 1)
        self.assertEqual(result["route_answer"]["choice"], "fast")
        self.assertIn("fast fake", result["message"])

    def test_high_and_boundary_risk_block_handler(self):
        for risk in (0.5, 0.9):
            with self.subTest(risk=risk):
                result = walkthrough.tool_gate_case(risk)
                self.assertEqual(result["status"], "error")
                self.assertEqual(result["handler_calls"], 0)

    def test_low_risk_reaches_only_the_fake_handler(self):
        result = walkthrough.tool_gate_case(0.1)
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["handler_calls"], 1)

    def test_classifier_failure_does_not_execute_handler(self):
        result = walkthrough.tool_gate_case(0.1, fail=True)
        self.assertEqual(result["status"], "classification_error")
        self.assertEqual(result["handler_calls"], 0)

    def test_unlisted_tool_bypasses_upstream_guard(self):
        result = walkthrough.tool_gate_case(0.9, tool_name="unlisted_fixture")
        self.assertEqual(result["classifier_calls"], 0)
        self.assertEqual(result["handler_calls"], 1)

    def test_policy_rejects_unknown_labels_or_inconsistent_score(self):
        for field in ("label", "score", "distribution"):
            body = deepcopy(walkthrough.FIXTURE)
            if field == "label":
                body["answers"]["department"]["choice"] = "unapproved"
            elif field == "score":
                body["answers"]["severity"]["score"] = 0.1
            else:
                body["answers"]["department"]["probabilities"]["technical"] = 0.1
            with self.subTest(field=field), self.assertRaises(ValueError):
                walkthrough.triage_policy(ClassifierResponse.model_validate(body))


class EvaluationTests(unittest.TestCase):
    def test_brier_uses_probabilities_not_thresholded_labels(self):
        report = walkthrough.calibration_metrics([0.9, 0.2], [1, 0])
        self.assertAlmostEqual(report["brier_score"], 0.025)
        self.assertEqual(report["precision"], 1)
        self.assertEqual(report["recall"], 1)

    def test_undefined_precision_is_not_reported_as_perfect(self):
        report = walkthrough.calibration_metrics([0.1], [1])
        self.assertIsNone(report["precision"])
        self.assertEqual(report["recall"], 0)

    def test_invalid_probabilities_are_rejected(self):
        for value in (-0.1, 1.1, math.nan, math.inf, True):
            with self.subTest(value=value), self.assertRaises(ValueError):
                walkthrough.calibration_metrics([value], [1])

    def test_live_requires_explicit_consent_and_a_key(self):
        from types import SimpleNamespace
        with patch.dict(os.environ, {"TYPESAFE_API_KEY": ""}), patch("walkthrough.TypeSafeClassifier") as client:
            for consent in (False, True):
                with self.assertRaises(ValueError):
                    walkthrough.live_classification(SimpleNamespace(confirm_live=consent, model="jev-latest"))
            client.assert_not_called()


if __name__ == "__main__":
    unittest.main()