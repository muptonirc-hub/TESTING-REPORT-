"""Parse VALD Hub CSV exports and map columns onto the app's metric names.

parse_files([(filename, bytes), ...]) -> (meta, results, messages)
  meta    : {"name","date","mass","sex"} where found
  results : {app_metric_name: value_str}
  messages: list of human-readable notes (what filled, what was ignored)
"""
import csv, io, re
from datetime import datetime

# Column -> app metric, keyed by Test Type. Column keys are normalised
# (lower-case, units in [..] stripped, whitespace collapsed).
TYPE_MAP = {
    "CMJ": {
        "jump height (imp-mom)": "Jump Height",
        "jump height (flight time)": "Jump Height",
        "jump height": "Jump Height",
        "peak power / bm": "Peak Power",
        "concentric peak force": "CMJ Peak Force",
        "peak force": "CMJ Peak Force",
        "concentric force asymmetry": "Concentric Asymmetry",
        "force asymmetry": "Concentric Asymmetry",
        "eccentric force asymmetry": "Landing Asymmetry",
        "landing force asymmetry": "Landing Asymmetry",
    },
    "IMTP": {
        "peak vertical force": "IMTP Peak Force",
        "peak force": "IMTP Peak Force",
        "net peak vertical force": "IMTP Peak Force",
        "peak vertical force / bm": "IMTP Relative Force",
        "force at 200ms": "IMTP RFD 0\u2013200 ms",
        "rfd 0-200 ms": "IMTP RFD 0\u2013200 ms",
        "rfd 0-200ms": "IMTP RFD 0\u2013200 ms",
    },
    "DJ": {
        "rsi (flight/contact time)": "Hop RSI (best)",
        "rsi (jump height/contact time)": "Hop RSI (best)",
        "rsi": "Hop RSI (best)",
        "contact time": "Hop Contact Time",
        "ground contact time": "Hop Contact Time",
    },
    # SmartSpeed linear sprint (total times). Provisional column names \u2014
    # confirm against a real SmartSpeed export.
    "SPRINT": {
        "10m": "10 m sprint", "10 m": "10 m sprint", "10m time": "10 m sprint",
        "10m total": "10 m sprint", "time 10m": "10 m sprint", "split 10m": "10 m sprint",
        "20m": "20 m sprint", "20 m": "20 m sprint", "20m time": "20 m sprint",
        "20m total": "20 m sprint", "time 20m": "20 m sprint", "split 20m": "20 m sprint",
        "30m": "30 m sprint", "30 m": "30 m sprint", "30m time": "30 m sprint",
        "30m total": "30 m sprint", "time 30m": "30 m sprint", "split 30m": "30 m sprint",
    },
}
# Columns that legitimately have no scored metric in the app (don't warn on these).
IGNORE = {"peak landing force", "rsi-modified", "additional load", "reps", "tags", "externalid", "time"}


def _norm(col):
    s = (col or "").strip().lower()
    s = re.sub(r"\[.*?\]", "", s)      # strip [unit]
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _fmt_date(v):
    v = (v or "").strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(v, fmt).strftime("%d %b %Y")
        except ValueError:
            pass
    return v


def _rows(data_bytes):
    text = data_bytes.decode("utf-8-sig", errors="replace")
    return list(csv.DictReader(io.StringIO(text)))


def _pick_row(rows):
    """If several rows, take the most recent by Date; else the first."""
    if len(rows) <= 1:
        return rows[0] if rows else None, len(rows)
    def key(r):
        for k in r:
            if _norm(k) == "date":
                for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y"):
                    try:
                        return datetime.strptime((r[k] or "").strip(), fmt)
                    except ValueError:
                        pass
        return datetime.min
    return max(rows, key=key), len(rows)


def parse_files(files):
    meta, results, messages = {}, {}, []
    for fname, data in files:
        try:
            rows = _rows(data)
        except Exception as e:
            messages.append(f"\u26a0 Could not read {fname}: {e}")
            continue
        if not rows:
            messages.append(f"\u26a0 {fname} had no data rows.")
            continue
        row, nrow = _pick_row(rows)
        # identify test type
        ttype = ""
        for k in row:
            if _norm(k) == "test type":
                ttype = (row[k] or "").strip().upper()
        cmap = TYPE_MAP.get(ttype, {})
        # meta
        for k, v in row.items():
            n = _norm(k); v = (v or "").strip()
            if not v:
                continue
            if n == "name" and not meta.get("name"):
                meta["name"] = v
            elif n == "date" and not meta.get("date"):
                meta["date"] = _fmt_date(v)
            elif n in ("bw", "body weight", "weight") and not meta.get("mass"):
                meta["mass"] = v
            elif n == "sex" and not meta.get("sex"):
                meta["sex"] = v.capitalize()
        # results
        filled, ignored = [], []
        for k, v in row.items():
            n = _norm(k); v = (v or "").strip()
            if n in ("name", "externalid", "test type", "date", "time", "bw",
                     "reps", "tags", "additional load", "sex") or not v:
                continue
            metric = cmap.get(n)
            if metric and metric not in results:
                results[metric] = v
                filled.append(metric)
            elif not metric and n not in IGNORE:
                ignored.append(k.strip())
        tag = f"{ttype or 'test'} \u00b7 {fname}"
        if nrow > 1:
            tag += f" (latest of {nrow} rows)"
        if filled:
            messages.append(f"\u2713 {tag}: filled {', '.join(filled)}.")
        else:
            messages.append(f"\u2013 {tag}: no mappable metrics recognised.")
        if ignored:
            messages.append(f"   (ignored columns: {', '.join(ignored)})")
    return meta, results, messages
