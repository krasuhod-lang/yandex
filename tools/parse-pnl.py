#!/usr/bin/env python3
"""
Parse `PNL - Выручай.ру.xlsx` into `data/pnl-baseline.json`.

The dashboard plan horizon starts at July 2026 (we drop May/June 2026
to match `PLAN_START_OFFSET=2` in dashboard-app.js). The resulting JSON
is the "план PNL" baseline against which the live economics model is
compared (see economics-model.js → comparePnl).

Usage:
    python3 tools/parse-pnl.py
"""
import json
import os
import sys
import unicodedata

try:
    import openpyxl  # type: ignore
except ImportError:
    print("openpyxl is required: pip install openpyxl", file=sys.stderr)
    raise

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _resolve(filename):
    # The xlsx files in the repo are stored as NFD-normalized strings, but a
    # literal Python string is NFC. Walk the directory and match by case-
    # insensitive NFC comparison so the parser works regardless of platform.
    want = unicodedata.normalize("NFC", filename).lower()
    for f in os.listdir(ROOT):
        if unicodedata.normalize("NFC", f).lower() == want:
            return os.path.join(ROOT, f)
    return os.path.join(ROOT, filename)


SRC = _resolve("PNL - Выручай.ру.xlsx")
DST = os.path.join(ROOT, "data", "pnl-baseline.json")
PLAN_START_OFFSET = 2  # drop May/June 2026


def num(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    ws = wb["Лист1"]
    rows = list(ws.iter_rows(values_only=True))
    header = list(rows[0])
    # header[0] = "Наименование", header[1:-1] = months, header[-1] = "Итого"
    months_raw = [str(m) for m in header[1:-1] if m]
    months = months_raw[PLAN_START_OFFSET:]

    sections = {}
    current_section = None

    # Map of canonical PNL line name (as it appears in xlsx) → category bucket.
    # We keep all numeric rows; categorize the ones the dashboard needs.
    LINE_TO_CATEGORY = {
        "ЗП Молодцов": "fixed_payroll",
        "ЗП Хасминский": "fixed_payroll",
        "SEO специалист 1": "fixed_payroll",
        "SEO специалист 2": "fixed_payroll",
        "SEO специалист 3": "fixed_payroll",
        "Копирайтер": "fixed_payroll",
        "Директолог": "fixed_payroll",
        "Яндекс директ": "variable_marketing",
        "Ссылки": "variable_marketing",
        "Накрутка ПФ": "variable_marketing",
        "PR (прокачка бренда)": "variable_marketing",
        "Разработка": "variable_dev",
        "Объем трафика": "traffic",
        "Повторный трафик": "traffic",
        "Объем визитов на офферы": "traffic",
        "Объем заявок": "funnel",
        "Объем апрувов": "funnel",
        "Выручка": "revenue",
        "Прибыль": "profit",
    }

    lines = []
    seen_revenue_total = False
    for row in rows[1:]:
        name = row[0]
        if not name:
            continue
        if isinstance(name, str) and name == row[1]:
            # Section header (e.g. "Постоянные расходы")
            current_section = name
            continue
        vals_all = [num(v) for v in row[1:-1]]
        if all(v is None for v in vals_all):
            continue
        total = num(row[-1])
        vals = vals_all[PLAN_START_OFFSET:]
        # Pick the first "Выручка" line (channel summary) as the global revenue,
        # subsequent "Выручка" lines belong to channel sub-sections.
        category = LINE_TO_CATEGORY.get(str(name).strip())
        is_total = isinstance(name, str) and name.strip() == "Итого"
        entry = {
            "name": str(name).strip(),
            "section": current_section,
            "category": category,
            "is_total": is_total,
            "values": vals,
            "plan_total": total,
        }
        if category == "revenue":
            if not seen_revenue_total and current_section == "Общий объем":
                entry["is_global_revenue"] = True
                seen_revenue_total = True
            else:
                # later "Выручка" lines belong to channel breakdowns
                entry["category"] = "channel_revenue"
                entry["channel"] = current_section
        lines.append(entry)

    # Aggregates from the explicit "Итого" rows where present, else computed.
    def sum_category(cat, section_filter=None):
        out = [0.0] * len(months)
        for ln in lines:
            if ln["category"] != cat or ln.get("is_total"):
                continue
            if section_filter is not None and ln.get("section") != section_filter:
                continue
            for i, v in enumerate(ln["values"]):
                if v is not None:
                    out[i] += v
        return out

    revenue_line = next((ln for ln in lines if ln.get("is_global_revenue")), None)
    profit_line = next((ln for ln in lines if ln["category"] == "profit"), None)

    summary = {
        "months": months,
        "revenue_total": revenue_line["values"] if revenue_line else [],
        "profit_total": profit_line["values"] if profit_line else [],
        "fixed_payroll_total": sum_category("fixed_payroll"),
        "variable_marketing_total": sum_category("variable_marketing"),
        "variable_dev_total": sum_category("variable_dev"),
    }
    expenses_total = [
        a + b + c
        for a, b, c in zip(
            summary["fixed_payroll_total"],
            summary["variable_marketing_total"],
            summary["variable_dev_total"],
        )
    ]
    summary["expenses_total"] = expenses_total

    out = {
        "source": "PNL - Выручай.ру.xlsx",
        "plan_start_offset": PLAN_START_OFFSET,
        "horizon_months": len(months),
        "months": months,
        "summary": summary,
        "lines": lines,
    }
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    with open(DST, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"Wrote {DST}: {len(months)} months, {len(lines)} lines.")


if __name__ == "__main__":
    main()
