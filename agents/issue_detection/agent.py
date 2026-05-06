"""
Issue Detection Agent — identifies infrastructure issue type and extracts
structured metadata from a citizen report using Gemini and (optionally)
the Google Cloud Vision API.
"""
from __future__ import annotations

import json
import sys
import os

# Allow importing from the shared package when running from this directory.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import google.generativeai as genai

from shared.utils import get_env, setup_logging

logger = setup_logging("issue_detection.agent")

# Valid report types (kept in sync with shared/models.py)
VALID_REPORT_TYPES = [
    "pothole",
    "water_leak",
    "power_outage",
    "broken_streetlight",
    "sewage",
    "road_damage",
    "other",
]

# Gemini configuration
_GEMINI_MODEL = get_env("GEMINI_MODEL", "gemini-flash-latest")


def _get_gemini_model() -> genai.GenerativeModel:
    api_key = get_env("GEMINI_API_KEY") or get_env("GOOGLE_API_KEY")
    if api_key:
        genai.configure(api_key=api_key)
    return genai.GenerativeModel(_GEMINI_MODEL)


# IssueDetectionAgent
class IssueDetectionAgent:
    """Analyzes citizen infrastructure reports to determine issue type."""

    def __init__(self) -> None:
        self._model: genai.GenerativeModel | None = None

    # Internal helpers

    def _model_instance(self) -> genai.GenerativeModel:
        if self._model is None:
            self._model = _get_gemini_model()
        return self._model

    def _analyze_images_with_vision(self, image_urls: list[str]) -> str:
        """
        Call Cloud Vision API for each image URL and return a combined
        description of any infrastructure damage found.

        Gracefully skips if credentials are unavailable.
        """
        try:
            from google.cloud import vision  # type: ignore
        except ImportError:
            logger.warning("google-cloud-vision not installed; skipping image analysis.")
            return ""

        try:
            client = vision.ImageAnnotatorClient()
        except Exception as exc:
            logger.warning("Vision API client init failed (%s); skipping image analysis.", exc)
            return ""

        summaries: list[str] = []
        for url in image_urls:
            try:
                image = vision.Image(source=vision.ImageSource(image_uri=url))
                response = client.label_detection(image=image)
                if response.error.message:
                    logger.warning("Vision API error for %s: %s", url, response.error.message)
                    continue
                labels = [label.description for label in response.label_annotations[:10]]
                summaries.append(f"Image ({url}): {', '.join(labels)}")
            except Exception as exc:
                logger.warning("Vision API call failed for %s: %s", url, exc)

        return "\n".join(summaries)

    def _build_prompt(
        self,
        description: str,
        location: str,
        vision_context: str,
        report_id: str,
    ) -> str:
        valid_types = ", ".join(VALID_REPORT_TYPES)
        vision_section = (
            f"\n\nImage analysis from Google Cloud Vision API:\n{vision_context}"
            if vision_context
            else ""
        )
        return f"""You are an infrastructure issue classifier for a city management system.

Analyze the following citizen report and classify the infrastructure issue.

Report ID: {report_id}
Location: {location}
Description: {description}{vision_section}

Return ONLY a valid JSON object with exactly these fields:
{{
  "report_type": "<one of: {valid_types}>",
  "confidence": <float between 0.0 and 1.0>,
  "analysis": "<1-3 sentence explanation of the identified issue>",
  "keywords": ["<keyword1>", "<keyword2>", ...]
}}

Rules:
- Choose the single most appropriate report_type.
- confidence should reflect how certain you are based on the description.
- keywords should capture the most important technical terms from the report.
- Return ONLY the JSON — no markdown fences, no extra text."""

    # Public API

    def analyze(
        self,
        description: str,
        location: str,
        media_urls: list[str] | None = None,
        report_id: str = "unknown",
    ) -> dict:
        """
        Analyze an infrastructure report and return structured classification.

        Returns a dict with keys: report_type, confidence, analysis, keywords.
        """
        media_urls = media_urls or []

        # Step 1: Optionally analyze attached images.
        vision_context = ""
        image_urls = [u for u in media_urls if u.lower().startswith(("http://", "https://"))]
        if image_urls:
            logger.info("Running Vision API analysis on %d image(s).", len(image_urls))
            vision_context = self._analyze_images_with_vision(image_urls)

        # Step 2: Build Gemini prompt.
        prompt = self._build_prompt(description, location, vision_context, report_id)

        # Step 3: Call Gemini.
        try:
            model = self._model_instance()
            response = model.generate_content(prompt)
            raw = response.text.strip()

            # Strip any accidental markdown fences.
            if raw.startswith("```"):
                lines = raw.splitlines()
                raw = "\n".join(
                    line for line in lines if not line.startswith("```")
                ).strip()

            result = json.loads(raw)
        except json.JSONDecodeError as exc:
            logger.error("Gemini returned non-JSON response: %s", exc)
            result = self._fallback_analysis(description)
        except Exception as exc:
            logger.error("Gemini call failed: %s", exc)
            result = self._fallback_analysis(description)

        # Step 4: Validate / normalise the output.
        result.setdefault("report_type", "other")
        result.setdefault("confidence", 0.5)
        result.setdefault("analysis", "Unable to fully analyze the report.")
        result.setdefault("keywords", [])

        if result["report_type"] not in VALID_REPORT_TYPES:
            result["report_type"] = "other"

        result["confidence"] = max(0.0, min(1.0, float(result["confidence"])))

        logger.info(
            "Report %s classified as '%s' (confidence=%.2f)",
            report_id,
            result["report_type"],
            result["confidence"],
        )
        return result

    # Fallback

    def _fallback_analysis(self, description: str) -> dict:
        """
        Rule-based fallback when Gemini is unavailable or returns garbage.
        """
        description_lower = description.lower()
        report_type = "other"
        keywords: list[str] = []

        rules = [
            (["pothole", "pot hole", "hole in road"], "pothole"),
            (["water leak", "leaking pipe", "burst pipe", "flooding", "flood"], "water_leak"),
            (["power outage", "no power", "electricity", "blackout", "no electricity"], "power_outage"),
            (["streetlight", "street light", "lamp post", "light broken"], "broken_streetlight"),
            (["sewage", "sewer", "drain blocked", "manhole"], "sewage"),
            (["road damage", "cracked road", "damaged road", "road surface"], "road_damage"),
        ]

        for triggers, rtype in rules:
            if any(t in description_lower for t in triggers):
                report_type = rtype
                keywords = [t for t in triggers if t in description_lower]
                break

        return {
            "report_type": report_type,
            "confidence": 0.6,
            "analysis": f"Fallback classification based on keyword matching: {description[:100]}",
            "keywords": keywords,
        }
