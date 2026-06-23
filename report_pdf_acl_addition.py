# ============================================================================
#  ACL REHAB PDF for report_pdf.py
#  Paste this whole function at the END of report_pdf.py.
#  It reuses the module-level helpers already in that file
#  (esc, fmt, chip-style, meter, COL, G, A, R, BLUE, DARK, INK, ...).
# ============================================================================

def render_acl_pdf(meta, phase, sex, groups, counts, disclaimer=""):
    icon = _icon_uri()
    icon_html = f'<img class="icon" src="{icon}"/>' if icon else ""

    def chip(st): return f'<span class="chip" style="background:{COL.get(st,"#999")}">{esc(st)}</span>' if st else ""
    def chg(r):
        c = r.get("change"); k = r.get("change_kind")
        if not c: return ""
        col = G if k == "gain" else (R if k == "drop" else MUTE)
        return f'<span style="color:{col};font-weight:700">{esc(c)}</span>'

    body = ""
    for gp in groups:
        body += f'<div class="grp">{esc(gp["title"])}</div>'
        for m in gp["rows"]:
            body += (f'<div class="row"><div class="mname">{esc(m["name"])}<span class="unit">{esc(m["unit"])}</span></div>'
                     f'<div class="mval">{fmt(m["result"])}</div>'
                     f'<div class="mmeter">{meter(m["result"], m.get("norm"))}<div class="tgt">phase target {esc(m["target"])}</div></div>'
                     f'<div class="mstat">{chip(m["status"])}<div class="chgc">{chg(m)}</div></div></div>')

    css = f"""
    @page {{ size:A4; margin:13mm 12mm; }}
    *{{box-sizing:border-box;font-family:'Liberation Sans','DejaVu Sans',sans-serif;}}
    body{{margin:0;color:{INK};font-size:10px;}}
    .hd{{display:flex;align-items:center;justify-content:space-between;background:{DARK};border-radius:6px;padding:11px 15px;border-bottom:4px solid {BLUE};}}
    .hd .brand{{display:flex;align-items:center;gap:11px;}} .hd .icon{{height:40px;width:40px;border-radius:50%;}}
    .hd .name{{color:#fff;font-size:18px;font-weight:800;letter-spacing:1.5px;line-height:1;}}
    .hd .name b{{color:{BLUE};}} .hd .name span{{display:block;color:#9AA3AD;font-size:7.5px;letter-spacing:3px;font-weight:600;margin-top:3px;}}
    .hd .ttl{{text-align:right;}} .hd h1{{margin:0;font-size:15px;color:#fff;}} .hd .sub{{color:{BLUE};font-size:9px;margin-top:2px;font-weight:600;}}
    .meta{{display:flex;flex-wrap:wrap;gap:4px 22px;margin:10px 2px;font-size:10px;}} .meta b{{color:{BLUE};font-weight:700;}}
    .band{{display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;}}
    .pop{{background:#EAF1F9;border:1px solid #BBD3EA;color:{BLUEINK};border-radius:4px;padding:3px 9px;font-weight:700;}}
    .counts span{{display:inline-block;color:#fff;border-radius:3px;padding:2px 9px;margin-left:5px;font-weight:700;}}
    .grp{{background:{GBAND};color:#fff;font-weight:700;font-size:9.5px;letter-spacing:.4px;padding:3px 8px;margin-top:7px;border-radius:3px;break-inside:avoid;break-after:avoid;}}
    .grp::before{{content:"";display:inline-block;width:7px;height:7px;background:{BLUE};border-radius:2px;margin-right:7px;}}
    .row{{display:grid;grid-template-columns:210px 56px 1fr 118px;align-items:center;gap:8px;padding:5px 6px;border-bottom:1px solid {LINE};break-inside:avoid;}}
    .mname{{font-weight:700;font-size:10px;}} .unit{{color:{MUTE};font-weight:400;font-size:8.5px;margin-left:5px;}}
    .mval{{font-weight:800;font-size:13px;text-align:center;color:{BLACK};}}
    .mt{{position:relative;display:flex;height:9px;border-radius:5px;overflow:hidden;background:#eee;}} .mt span{{display:block;height:100%;}}
    .mk{{position:absolute;top:-2px;width:3px;height:13px;background:{BLACK};border-radius:2px;box-shadow:0 0 0 1.5px #fff;}}
    .tgt{{font-size:8px;color:{MUTE};margin-top:2px;}} .mstat{{text-align:right;}} .chgc{{font-size:8.5px;margin-top:2px;}}
    .foot{{margin-top:12px;font-size:8px;color:{MUTE};font-style:italic;border-top:2px solid {BLUE};padding-top:6px;}}
    """

    doc = f"""<html><head><meta charset="utf-8"><style>{css}</style></head><body>
    <div class="hd"><div class="brand">{icon_html}<div class="name">BASE <b>HEALTH</b><span>NOOSA</span></div></div>
    <div class="ttl"><h1>ACL Rehab &amp; Return-to-Play</h1>
    <div class="sub">ACLR research norms \u2022 injured-limb / symmetry tracking</div></div></div>
    <div class="meta">
    <span><b>Athlete</b> {esc(meta.get('name'))}</span><span><b>Date</b> {esc(meta.get('date'))}</span>
    <span><b>Injured side</b> {esc(meta.get('injured'))}</span><span><b>Graft</b> {esc(meta.get('graft'))}</span>
    <span><b>Surgeon</b> {esc(meta.get('surgeon'))}</span><span><b>Months post-op</b> {esc(meta.get('months'))}</span>
    <span><b>Sport</b> {esc(meta.get('sport'))}</span><span><b>Notes</b> {esc(meta.get('notes'))}</span></div>
    <div class="band"><div>Rehab phase <span class="pop">{esc(phase)} \u00b7 {esc(sex)}</span></div>
    <div class="counts"><span style="background:{G}">On/ahead: {counts['Green']}</span>
    <span style="background:{A}">Within 1 SD: {counts['Amber']}</span>
    <span style="background:{R}">&gt;1 SD behind: {counts['Red']}</span></div></div>
    {body}
    <div class="foot">{esc(disclaimer)}</div>
    </body></html>"""
    return HTML(string=doc).write_pdf()
