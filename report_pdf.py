"""Render the premium athlete PDF (returns bytes). Uses weasyprint. BASE Health branded."""
import html, base64, os
from weasyprint import HTML

BLUE="#5688C7";BLUEINK="#345E86";DARK="#15171B";BLACK="#17191C";INK="#1A2233";MUTE="#5A6573";LINE="#D7DCE5"
GBAND="#20242B"
G="#2E7D32";A="#DD8800";R="#C62828"
COL={"Green":G,"Amber":A,"Red":R}

def _icon_uri():
    p=os.path.join(os.path.dirname(__file__),"favicon.png")
    try:
        with open(p,"rb") as f:
            return "data:image/png;base64,"+base64.b64encode(f.read()).decode()
    except Exception:
        return ""

def _f(v):
    try: return float(v)
    except (TypeError,ValueError): return None

def fmt(v):
    f=_f(v)
    if f is None: return html.escape(str(v)) if v not in (None,"") else "\u2014"
    if f==int(f): return str(int(f))
    if abs(f)>=100: return str(int(round(f)))
    if abs(f)>=10: return f"{f:.1f}"
    return f"{f:.2f}"

def esc(x): return html.escape(str(x)) if x not in (None,"") else "\u2014"

def meter(result, n):
    r=_f(result)
    if r is None or not n: return '<div class="mt"></div>'
    d=n.get("dir");g=_f(n.get("green"));a=_f(n.get("amber"));gm=_f(n.get("gmax"));am=_f(n.get("amax"))
    if d in ("Higher","Lower") and g is not None and a is not None:
        if d=="Higher":
            lo=max(0,min(r,a)*0.8);hi=max(r,g)*1.12;hi=max(hi,g*1.05);pts=[(R,lo,a),(A,a,g),(G,g,hi)]
        else:
            hi=max(r,a)*1.12;lo=max(0,min(r,g)*0.8);pts=[(G,lo,g),(A,g,a),(R,a,hi)]
    elif gm is not None and am is not None:
        g=_f(g);gm=_f(gm);a=_f(a);am=_f(am)
        lo=min(r,a)*0.9;hi=max(r,am)*1.1;pts=[(R,lo,a),(A,a,g),(G,g,gm),(A,gm,am),(R,am,hi)]
    else:
        return '<div class="mt"></div>'
    span=(hi-lo) or 1
    segs="".join(f'<span style="width:{max(0,(e-s)/span*100):.2f}%;background:{c}"></span>' for c,s,e in pts)
    mk=min(100,max(0,(r-lo)/span*100))
    return f'<div class="mt">{segs}<i class="mk" style="left:{mk:.1f}%"></i></div>'

ASYM = lambda n: ("Asymmetry" in n) or ("Imbalance" in n)
DOMAIN_MAP = [("COUNTERMOVEMENT", "Jump / power"), ("MID-THIGH", "Max strength"),
              ("HOP", "Reactive"), ("NORDIC", "Hamstring"), ("HIP", "Hip / groin"),
              ("DYNAMIC STRENGTH", "DSI"), ("DYNAMO", "Isometric")]
WORST = {"Red": 3, "Amber": 2, "Green": 1}

def _short_domain(title):
    for k, v in DOMAIN_MAP:
        if k in title:
            return v
    return title.title()

def scorecard(groups):
    cards = []
    for gp in groups:
        sts = [r["status"] for r in gp["rows"] if r["status"] in WORST]
        if not sts:
            continue
        worst = max(sts, key=lambda s: WORST[s])
        green = sum(1 for s in sts if s == "Green")
        col = COL[worst]
        cards.append(
            f'<div class="card"><div class="ctop" style="background:{col}"></div>'
            f'<div class="cbody"><span class="cst" style="color:{col}">{worst}</span>'
            f'<div class="cdom">{esc(_short_domain(gp["title"]))}</div>'
            f'<div class="csub">{green}/{len(sts)} on target</div></div></div>')
    return f'<div class="scorecard">{"".join(cards)}</div>' if cards else ""

def asym_section(groups):
    rows = [r for gp in groups for r in gp["rows"] if ASYM(r["name"])]
    if not rows:
        return ""
    SCALE = 25.0
    out = ['<div class="sec">Limb symmetry \u2014 L vs R</div>',
           '<div class="asy-head"><span>\u25c0 LEFT higher</span><span>balanced</span>'
           '<span>RIGHT higher \u25b6</span></div>']
    for r in rows:
        pct = _f(r["result"])
        if pct is None:
            continue
        w = min(50.0, pct / SCALE * 50.0)
        col = COL.get(r["status"], "#999")
        side = r.get("side", "")
        if side == "L":
            fill = f"left:{50-w:.1f}%;width:{w:.1f}%"
        elif side == "R":
            fill = f"left:50%;width:{w:.1f}%"
        else:
            fill = "left:49%;width:2%"
        ticks = ""
        g = (r.get("norm") or {}).get("green")
        gg = _f(g)
        if gg is not None:
            tw = min(50.0, gg / SCALE * 50.0)
            ticks = (f'<i class="asy-tick" style="left:{50-tw:.1f}%"></i>'
                     f'<i class="asy-tick" style="left:{50+tw:.1f}%"></i>')
        sd = f" ({side} higher)" if side else ""
        out.append(
            f'<div class="asy-row"><div class="asy-name">{esc(r["name"])}</div>'
            f'<div class="asy-track"><div class="asy-center"></div>{ticks}'
            f'<div class="asy-fill" style="{fill};background:{col}"></div></div>'
            f'<div class="asy-val">{fmt(pct)}%{sd}</div></div>')
    out.append('<div class="asy-note">Bar length = asymmetry magnitude; faint ticks mark the '
               'balanced (green) limit. Direction = higher/dominant side.</div>')
    return "".join(out)

def render_pdf(meta, population, groups, counts, prios):
    icon=_icon_uri()
    icon_html=f'<img class="icon" src="{icon}"/>' if icon else ""
    def chip(st): return f'<span class="chip" style="background:{COL.get(st,"#999")}">{esc(st)}</span>' if st else ""
    def chg(r):
        c=r.get("change");k=r.get("change_kind")
        if not c: return ""
        col=G if k=="gain" else (R if k=="drop" else MUTE)
        return f'<span style="color:{col};font-weight:700">{esc(c)}</span>'
    prio_html="".join(
        f'<div class="prow">{chip(r["status"])}<b>{esc(r["name"])}</b>'
        f'<span class="pdet">= {fmt(r["result"])} {esc(r["unit"])}'
        f'{(" (" + esc(r["side"]) + " higher)") if r.get("side") else ""}'
        f'  \u00b7  needs {esc(r["target"])}  \u00b7  {esc(r["source"])}</span></div>'
        for r in prios) or f'<div class="prow"><span style="color:{G}">\u2713 Nothing flagged \u2014 all tested metrics on target.</span></div>'
    body=""
    for gp in groups:
        body+=f'<div class="grp">{esc(gp["title"])}</div>'
        for m in gp["rows"]:
            sd=f' <span style="color:{BLUE};font-weight:700;font-size:8.5px">\u00b7 {esc(m["side"])} higher</span>' if m.get("side") else ""
            body+=(f'<div class="row"><div class="mname">{esc(m["name"])}<span class="unit">{esc(m["unit"])}</span>{sd}</div>'
                   f'<div class="mval">{fmt(m["result"])}</div>'
                   f'<div class="mmeter">{meter(m["result"],m.get("norm"))}<div class="tgt">target {esc(m["target"])}</div></div>'
                   f'<div class="mstat">{chip(m["status"])}<div class="chgc">{chg(m)}</div></div></div>')
    css=f"""
    @page {{ size:A4; margin:13mm 12mm; }}
    *{{box-sizing:border-box;font-family:'Liberation Sans','DejaVu Sans',sans-serif;}}
    body{{margin:0;color:{INK};font-size:10px;}}
    .hd{{display:flex;align-items:center;justify-content:space-between;background:{DARK};border-radius:6px;padding:11px 15px;border-bottom:4px solid {BLUE};}}
    .hd .brand{{display:flex;align-items:center;gap:11px;}}
    .hd .icon{{height:40px;width:40px;border-radius:50%;}}
    .hd .name{{color:#fff;font-size:18px;font-weight:800;letter-spacing:1.5px;line-height:1;}}
    .hd .name b{{color:{BLUE};}}
    .hd .name span{{display:block;color:#9AA3AD;font-size:7.5px;letter-spacing:3px;font-weight:600;margin-top:3px;}}
    .hd .ttl{{text-align:right;}}
    .hd h1{{margin:0;font-size:15px;color:#fff;letter-spacing:.2px;}}
    .hd .sub{{color:{BLUE};font-size:9px;margin-top:2px;font-weight:600;}}
    .meta{{display:flex;flex-wrap:wrap;gap:4px 22px;margin:10px 2px;font-size:10px;}}
    .meta b{{color:{BLUE};font-weight:700;}}
    .band{{display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;}}
    .pop{{background:#EAF1F9;border:1px solid #BBD3EA;color:{BLUEINK};border-radius:4px;padding:3px 9px;font-weight:700;}}
    .counts span{{display:inline-block;color:#fff;border-radius:3px;padding:2px 9px;margin-left:5px;font-weight:700;}}
    .sec{{font-weight:800;color:{BLACK};font-size:11px;letter-spacing:.5px;margin:12px 2px 5px;border-bottom:2px solid {BLUE};padding-bottom:3px;}}
    .prow{{display:flex;align-items:center;gap:8px;padding:4px 6px;border-bottom:1px solid {LINE};break-inside:avoid;}}
    .pdet{{color:{MUTE};font-size:9px;margin-left:auto;text-align:right;}}
    .chip{{color:#fff;border-radius:3px;padding:1px 7px;font-weight:700;font-size:9px;}}
    .grp{{background:{GBAND};color:#fff;font-weight:700;font-size:9.5px;letter-spacing:.4px;padding:3px 8px;margin-top:7px;border-radius:3px;break-inside:avoid;break-after:avoid;}}
    .grp::before{{content:"";display:inline-block;width:7px;height:7px;background:{BLUE};border-radius:2px;margin-right:7px;}}
    .row{{display:grid;grid-template-columns:150px 52px 1fr 120px;align-items:center;gap:8px;padding:5px 6px;border-bottom:1px solid {LINE};break-inside:avoid;}}
    .mname{{font-weight:700;font-size:10px;}} .unit{{color:{MUTE};font-weight:400;font-size:8.5px;margin-left:5px;}}
    .mval{{font-weight:800;font-size:13px;text-align:center;color:{BLACK};}}
    .mt{{position:relative;display:flex;height:9px;border-radius:5px;overflow:hidden;background:#eee;}}
    .mt span{{display:block;height:100%;}}
    .mk{{position:absolute;top:-2px;width:3px;height:13px;background:{BLACK};border-radius:2px;box-shadow:0 0 0 1.5px #fff;}}
    .tgt{{font-size:8px;color:{MUTE};margin-top:2px;}} .mstat{{text-align:right;}} .chgc{{font-size:8.5px;margin-top:2px;}}
    .foot{{margin-top:12px;font-size:8px;color:{MUTE};font-style:italic;border-top:2px solid {BLUE};padding-top:6px;}}
    .scorecard{{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0;}}
    .card{{flex:1;min-width:108px;border:1px solid {LINE};border-radius:5px;overflow:hidden;}}
    .card .ctop{{height:5px;}}
    .card .cbody{{padding:4px 8px 6px;}}
    .card .cst{{float:right;font-weight:800;font-size:9px;}}
    .card .cdom{{font-weight:700;font-size:9.5px;color:{BLACK};}}
    .card .csub{{font-size:8px;color:{MUTE};margin-top:1px;}}
    .asy-head{{display:flex;justify-content:space-between;font-size:7.5px;color:{MUTE};font-weight:700;letter-spacing:.5px;margin:3px 2px;}}
    .asy-row{{display:grid;grid-template-columns:150px 1fr 96px;align-items:center;gap:8px;padding:4px 6px;border-bottom:1px solid {LINE};break-inside:avoid;}}
    .asy-name{{font-weight:700;font-size:9.5px;}}
    .asy-track{{position:relative;height:13px;background:#F0F2F5;border-radius:3px;}}
    .asy-center{{position:absolute;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;background:#8A93A0;}}
    .asy-tick{{position:absolute;top:0;bottom:0;width:1px;background:#C2C9D2;}}
    .asy-fill{{position:absolute;top:2px;bottom:2px;border-radius:2px;}}
    .asy-val{{font-size:9px;text-align:right;font-weight:700;color:{BLACK};}}
    .asy-note{{font-size:7.5px;color:{MUTE};font-style:italic;margin:5px 2px 0;}}
    """
    doc=f"""<html><head><meta charset="utf-8"><style>{css}</style></head><body>
    <div class="hd">
      <div class="brand">{icon_html}<div class="name">BASE <b>HEALTH</b><span>NOOSA</span></div></div>
      <div class="ttl"><h1>Athlete Performance &amp; Readiness Report</h1>
      <div class="sub">VALD Testing \u2022 Normative screening with change-vs-previous</div></div></div>
    <div class="meta">
      <span><b>Athlete</b> {esc(meta.get('name'))}</span><span><b>Date</b> {esc(meta.get('date'))}</span>
      <span><b>Sport</b> {esc(meta.get('sport'))}</span><span><b>Tester</b> {esc(meta.get('tester'))}</span>
      <span><b>Age</b> {esc(meta.get('age'))}</span><span><b>Sex</b> {esc(meta.get('sex'))}</span>
      <span><b>Mass</b> {esc(meta.get('mass'))} kg</span>
      <span><b>Notes</b> {esc(meta.get('notes'))}</span></div>
    <div class="band"><div>Compared against <span class="pop">{esc(population)}</span></div>
      <div class="counts"><span style="background:{G}">Green: {counts['Green']}</span>
      <span style="background:{A}">Amber: {counts['Amber']}</span><span style="background:{R}">Red: {counts['Red']}</span></div></div>
    <div class="sec">Overview by area</div>{scorecard(groups)}
    <div class="sec">Top priorities \u2014 worst first</div>{prio_html}
    {asym_section(groups)}
    <div class="sec">Full results</div>{body}
    <div class="foot">Confidence shown in grey (\u2605\u2605\u2605 strong \u00b7 \u2605\u2605\u2606 moderate \u00b7 \u2605\u2606\u2606 weak).
    Norms are population- and protocol-dependent; targets reflect the selected reference population only.
    This report organises and displays testing data and is not medical advice.</div>
    </body></html>"""
    return HTML(string=doc).write_pdf()
