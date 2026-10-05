"""Weekly report: the AI writes words around numbers the app computed (spec §5.2)."""

import json
import re
from datetime import date
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints

PROMPT_VERSION = "weekly-report-1"

SYSTEM = """You write a short weekly progress report for one person using a body-recomposition
tracking app (losing fat while keeping or gaining muscle).

You get the week's facts as JSON inside <facts> tags. Write from those facts only:
- Use only numbers that appear in the facts, with the same units and rounding. Do not
  calculate new numbers (no percentages of targets, no sums, no differences that aren't given).
- If something is missing or sparse (few days logged, few weigh-ins), say so plainly instead of
  guessing; don't invent trends.
- Weight changes of a few tenths of a kilo in a week are mostly water; lean on the trend values
  and rates given, not single days.
- Be encouraging without overpraising, and direct about what didn't go well.
- No medical advice or diagnoses, and no extreme diets. Suggest only ordinary, practical habits.

Return:
- summary: two or three sentences on the week as a whole.
- sections: two to four short sections (for example body trend, eating, burn and targets,
  goals). Give each a short title, a body of two to four sentences, and a tone: "good" when
  things went well, "watch" when something needs attention, "neutral" otherwise.
- focus: one to three concrete, small things to do next week."""

Tone = Literal["good", "watch", "neutral"]


class Section(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=700)]
    tone: Tone


class ReportOut(BaseModel):
    summary: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=400)]
    sections: list[Section] = Field(min_length=2, max_length=4)
    focus: list[
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=140)]
    ] = Field(min_length=1, max_length=3)


def user_text(facts: dict[str, Any]) -> str:
    return (
        "Write this week's report.\n\n<facts>\n"
        + json.dumps(facts, indent=1, ensure_ascii=False)
        + "\n</facts>"
    )


# --- Keeping the numbers honest ----------------------------------------------------------

_NUMBER = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?")
SMALL = {str(n) for n in range(0, 15)}  # counts like "3 days" and list numbering


def _variants(value: float) -> set[str]:
    """The value as written in full, to one decimal or as a whole number, rounding either
    way at a half (0.35 may be written 0.3 or 0.4)."""
    v = abs(value)
    out = {f"{v:g}"}
    for nudge in (-1e-9, 1e-9):
        out |= {f"{v + nudge:.1f}", f"{v + nudge:.0f}"}
    return {_trim(s) for s in out}


def allowed_numbers(facts: Any) -> set[str]:
    """Every way a number in the facts may fairly be written, plus small counts and dates."""
    allowed = set(SMALL)

    def walk(node: Any) -> None:
        if isinstance(node, bool) or node is None:
            return
        if isinstance(node, int | float):
            allowed.update(_variants(float(node)))
        elif isinstance(node, str):
            try:
                d = date.fromisoformat(node)
                allowed.update(
                    {str(d.day), str(d.month), str(d.year), f"{d.day:02d}", f"{d.month:02d}"}
                )
            except ValueError:
                for m in _NUMBER.findall(node):
                    allowed.add(m.replace(",", ""))
        elif isinstance(node, dict):
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(facts)
    return allowed


def unsupported_numbers(report: ReportOut, facts: dict[str, Any]) -> list[str]:
    """Numbers in the report that don't come from the facts."""
    text = " ".join(
        [report.summary, *(s.title + " " + s.body for s in report.sections), *report.focus]
    )
    allowed = allowed_numbers(facts)
    found = [m.replace(",", "") for m in _NUMBER.findall(text)]
    return [n for n in found if n not in allowed and _trim(n) not in allowed]


def _trim(number: str) -> str:
    """84.30 → 84.3 and 2.0 → 2; whole numbers are left alone (2300 stays 2300)."""
    return number.rstrip("0").rstrip(".") if "." in number else number


# --- Plain fallback ----------------------------------------------------------------------


def _signed(value: float, unit: str) -> str:
    return f"{value:+g} {unit}".strip()


def template_report(facts: dict[str, Any]) -> ReportOut:
    """A plain report from the facts, used when the AI's text can't be trusted."""
    food = facts.get("food", {})
    body = facts.get("body", {})
    logged = food.get("days_logged", 0)

    body_lines = []
    for m in body.values():
        line = f"{m['label']}: {m['now']:g} {m['unit']}".rstrip()
        if m.get("change") is not None:
            line += f" ({_signed(m['change'], m['unit'])} on the week)"
        body_lines.append(line + ".")
    if not body_lines:
        body_lines.append("No weigh-ins with a trend yet.")
    body_lines.append(f"{facts.get('weigh_ins', 0)} weigh-ins this week.")

    food_lines = [f"{logged} of 7 days logged."]
    if "avg_kcal" in food:
        line = f"Average {food['avg_kcal']} kcal"
        if "avg_protein_g" in food:
            line += f" and {food['avg_protein_g']} g protein"
        line += " a day"
        if "target_kcal" in food:
            line += f", against a target of {food['target_kcal']} kcal"
        food_lines.append(line + ".")
    if "protein_target_days_hit" in food:
        food_lines.append(f"Protein target reached on {food['protein_target_days_hit']} days.")

    sections = [
        Section(title="Body", body=" ".join(body_lines), tone="neutral"),
        Section(
            title="Eating", body=" ".join(food_lines), tone="neutral" if logged >= 5 else "watch"
        ),
    ]
    burn = facts.get("burn")
    if burn:
        kind = "Measured" if burn["measured"] else "Estimated"
        sections.append(
            Section(
                title="Burn",
                body=f"{kind} burn: about {burn['tdee_kcal']} kcal a day.",
                tone="neutral",
            )
        )
    focus = (
        ["Log every day this week, even rough entries."]
        if logged < 5
        else ["Keep logging and weighing in as you did this week."]
    )
    end = date.fromisoformat(facts["week"]["to"])
    summary = f"Week to {end.day} {end:%B}: {logged} of 7 days logged."
    if "weight_kg" in body:
        summary += f" Weight trend {body['weight_kg']['now']:g} kg."
    return ReportOut(summary=summary, sections=sections, focus=focus)
