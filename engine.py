"""Compute traffic-light status, change-vs-previous, targets and priorities.
Pure Python, no dependencies. Shared by the Streamlit app and the PDF renderer."""

def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None

def status(result, norm):
    """Return 'Green' | 'Amber' | 'Red' | 'n/a' | '' for a result against a norm dict."""
    r = _num(result)
    if r is None:
        return ""
    if not norm:
        return "n/a"
    d = norm.get("dir"); g = _num(norm.get("green")); a = _num(norm.get("amber"))
    gm = _num(norm.get("gmax")); am = _num(norm.get("amax"))
    if d == "Higher":
        if g is not None and r >= g: return "Green"
        if a is not None and r >= a: return "Amber"
        return "Red"
    if d == "Lower":
        if g is not None and r <= g: return "Green"
        if a is not None and r <= a: return "Amber"
        return "Red"
    if d == "Band":
        if g is not None and gm is not None and g <= r <= gm: return "Green"
        if a is not None and am is not None and a <= r <= am: return "Amber"
        return "Red"
    return "n/a"

def target_str(norm):
    if not norm:
        return "n/a"
    d = norm.get("dir"); g = norm.get("green"); gm = norm.get("gmax")
    if d == "Higher": return f"\u2265 {g}"
    if d == "Lower":  return f"\u2264 {g}"
    if d == "Band":   return f"{g} \u2013 {gm}"
    return "n/a"

def change(result, previous, direction, thr):
    """Direction-aware change flag. Returns (text, kind) where kind in gain/drop/noise/''."""
    r = _num(result); p = _num(previous); t = _num(thr)
    if r is None or p is None:
        return "", ""
    delta = r - p
    pct = (delta / p * 100) if p else None
    disp = (f"{delta:+.2f}".rstrip("0").rstrip(".") if abs(delta) < 10 else f"{delta:+.0f}")
    if pct is not None:
        disp += f" ({pct:+.0f}%)"
    if t is not None and abs(delta) < t:
        return f"\u2013 within noise   {disp}", "noise"
    if direction == "Higher":
        good = delta > 0
    elif direction == "Lower":
        good = delta < 0
    else:
        return f"\u25cf meaningful shift   {disp}", "shift"
    return (f"\u25b2 real gain   {disp}", "gain") if good else (f"\u25bc real drop   {disp}", "drop")

def build_rows(inputs, population, norms, age_band=None, mass=None):
    """inputs: {metric: {'result':x,'previous':y,'side':...}}.  age_band e.g. '30-40 years'.
    mass (kg) is used to body-weight-score metrics whose calc == 'PERKG' (entered in N -> N/kg).
    Band-specific norm used where available; otherwise falls back to the all-ages norm."""
    popnorms = norms["populations"].get(population, {})
    band = {}
    if age_band and age_band != "All ages":
        band = norms.get("age_norms", {}).get(population, {}).get(age_band, {})
    m_kg = _num(mass)
    # DSI is derived from CMJ Peak Force / IMTP Peak Force
    cmj = _num(inputs.get("CMJ Peak Force", {}).get("result"))
    imtp = _num(inputs.get("IMTP Peak Force", {}).get("result"))
    dsi_val = round(cmj / imtp, 2) if (cmj and imtp) else None
    groups = []
    for g in norms["groups"]:
        rows = []
        for m in g["metrics"]:
            name = m["name"]
            inp = inputs.get(name, {})
            prev_for_change = inp.get("previous")
            if m["calc"] == "DSI":
                result = dsi_val
            elif m["calc"] == "PERKG":
                raw = _num(inp.get("result"))
                result = round(raw / m_kg, 2) if (raw and m_kg) else None
                pr = _num(inp.get("previous"))
                prev_for_change = round(pr / m_kg, 2) if (pr and m_kg) else None
            elif m["calc"] == "PERBW":
                raw = _num(inp.get("result"))
                result = round(raw / (m_kg * 9.81), 2) if (raw and m_kg) else None
                pr = _num(inp.get("previous"))
                prev_for_change = round(pr / (m_kg * 9.81), 2) if (pr and m_kg) else None
            else:
                result = inp.get("result")
            if result in (None, ""):
                continue
            norm = band.get(name) or popnorms.get(name)
            st = status(result, norm)
            ch, kind = change(result, prev_for_change, m["dir"], m["thr"])
            rows.append(dict(name=name, unit=m["unit"], result=result, status=st,
                             target=target_str(norm), source=(norm or {}).get("source", ""),
                             norm=norm, change=ch, change_kind=kind, side=inp.get("side", "")))
        if rows:
            groups.append(dict(title=g["title"], rows=rows))
    return groups

def flatten(groups):
    return [r for g in groups for r in g["rows"]]

def counts(groups):
    rows = flatten(groups)
    c = {"Green": 0, "Amber": 0, "Red": 0}
    for r in rows:
        if r["status"] in c:
            c[r["status"]] += 1
    return c

def priorities(groups, n=5):
    rows = flatten(groups)
    order = {"Red": 0, "Amber": 1}
    flagged = [r for r in rows if r["status"] in order]
    flagged.sort(key=lambda r: order[r["status"]])
    return flagged[:n]

def build_ham_rows(inputs, phase, ham):
    """Hamstring rehab rows: injured-limb result vs the selected phase's target."""
    pnorms = ham["norms"].get(phase, {})
    groups = []
    for g in ham["groups"]:
        rows = []
        for m in g["metrics"]:
            name = m["name"]
            inp = inputs.get(name, {})
            result = inp.get("result")
            if result in (None, ""):
                continue
            norm = pnorms.get(name)
            rows.append(dict(name=name, unit=m["unit"], result=result,
                             status=status(result, norm), target=target_str(norm),
                             source=(norm or {}).get("source", ""), norm=norm, side="",
                             change=change(result, inp.get("previous"), m["dir"], m["thr"])[0],
                             change_kind=change(result, inp.get("previous"), m["dir"], m["thr"])[1]))
        if rows:
            groups.append(dict(title=g["title"], rows=rows))
    return groups
