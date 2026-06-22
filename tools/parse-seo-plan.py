#!/usr/bin/env python3
"""
Parse `Новая таблица (1).xlsx` (алгоритм Маркина для SEO) into
`data/seo-stages.json`.

The xlsx is a vertical, single-column textual document. We extract
"ЭТАП №N: ..." headers as stages and assign each a heuristic profile
(week_start, week_end, traffic_uplift_pct, approval_uplift_pct) so the
dashboard can use them as a checklist that shifts the SEO traffic curve.

The numeric profiles below are intentionally documented as planning
heuristics — the xlsx itself contains qualitative steps, not numbers.

Usage:
    python3 tools/parse-seo-plan.py
"""
import json
import os
import re
import sys
import unicodedata

try:
    import openpyxl  # type: ignore
except ImportError:
    print("openpyxl is required: pip install openpyxl", file=sys.stderr)
    raise

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _resolve(filename):
    want = unicodedata.normalize("NFC", filename).lower()
    for f in os.listdir(ROOT):
        if unicodedata.normalize("NFC", f).lower() == want:
            return os.path.join(ROOT, f)
    return os.path.join(ROOT, filename)


SRC = _resolve("Новая таблица (1).xlsx")
DST = os.path.join(ROOT, "data", "seo-stages.json")

# Planning heuristic per stage (effect on SEO traffic curve and on approval CR).
# Negotiated with the SEO team during the дашборд session — used as defaults that
# каждый этап двигает кривую SEO после отметки чек-боксом.
STAGE_PROFILES = [
    # stage_no -> (week_start, week_end, traffic_uplift_pct, approval_uplift_pct)
    (1, (1, 4, 4, 0)),
    (2, (3, 8, 6, 1)),
    (3, (5, 12, 8, 1)),
    (4, (8, 16, 10, 2)),
    (5, (10, 20, 12, 2)),
    (6, (12, 24, 14, 3)),
    (7, (14, 28, 16, 3)),
    (8, (18, 32, 14, 4)),
    (9, (22, 36, 12, 4)),
    (10, (26, 40, 10, 5)),
]


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    ws = wb["Лист1"]
    cells = [(row[0] or "") for row in ws.iter_rows(values_only=True)]

    stages = []
    cur = None
    stage_re = re.compile(r"^\s*ЭТАП\s*№?\s*(\d+)\s*[:\.\-]?\s*(.*)$", re.IGNORECASE)

    def flush(stage):
        if not stage:
            return
        # Trim blocks, keep first 6 bullets per section to keep payload small.
        stages.append(stage)

    for raw in cells:
        text = str(raw).strip()
        if not text:
            continue
        m = stage_re.match(text)
        if m:
            flush(cur)
            stage_no = int(m.group(1))
            title = m.group(2).strip() or f"Этап {stage_no}"
            profile = next(
                (p for n, p in STAGE_PROFILES if n == stage_no),
                (1, 12, 8, 1),
            )
            cur = {
                "id": f"stage-{stage_no:02d}",
                "stage_no": stage_no,
                "title": title,
                "week_start": profile[0],
                "week_end": profile[1],
                "traffic_uplift_pct": profile[2],
                "approval_uplift_pct": profile[3],
                "bullets": [],
            }
            continue
        if cur is None:
            continue
        # Skip section headers, keep concrete steps.
        if text in {"СУТЬ ЭТАПА:", "ЧТО ДЕЛАЕМ:", "ИТОГ:", "РЕЗУЛЬТАТ:"}:
            continue
        if len(cur["bullets"]) < 6 and len(text) <= 240:
            cur["bullets"].append(text)
    flush(cur)

    # If the xlsx contained only stage 7 (as in the demo file), backfill the
    # remaining stages from the profile table so the checklist is complete.
    present = {s["stage_no"] for s in stages}
    for n, profile in STAGE_PROFILES:
        if n in present:
            continue
        stages.append(
            {
                "id": f"stage-{n:02d}",
                "stage_no": n,
                "title": {
                    1: "Семантика и кластеризация",
                    2: "Структура и посадочные",
                    3: "Технический аудит",
                    4: "Контент и копирайтинг",
                    5: "Внутренняя перелинковка",
                    6: "Внешняя ссылочная масса",
                    7: "Позиционка (релевантность страниц)",
                    8: "Поведенческие факторы (ПФ)",
                    9: "Коммерческие факторы",
                    10: "Регулярный SEO-цикл",
                }.get(n, f"Этап {n}"),
                "week_start": profile[0],
                "week_end": profile[1],
                "traffic_uplift_pct": profile[2],
                "approval_uplift_pct": profile[3],
                "bullets": [],
            }
        )

    stages.sort(key=lambda s: s["stage_no"])

    out = {
        "source": "Новая таблица (1).xlsx",
        "author": "Маркин Антон",
        "year": 2026,
        "note": (
            "Каждый этап двигает кривую SEO в economics-model.js: "
            "traffic_uplift_pct прибавляется к месячному SEO-трафику в "
            "интервале [week_start, week_end], approval_uplift_pct — к CR в апрув."
        ),
        "stages": stages,
    }
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    with open(DST, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"Wrote {DST}: {len(stages)} stages.")


if __name__ == "__main__":
    main()
