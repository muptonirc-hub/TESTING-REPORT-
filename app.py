"""
VALD Athlete Report — type-in web app.
Enter results, see traffic lights live, download the premium PDF.
"""
import json, os
import streamlit as st
import engine
import report_pdf

_icon = "favicon.png" if os.path.exists("favicon.png") else "\U0001F3C3"
st.set_page_config(page_title="BASE Health \u2014 Athlete Report", page_icon=_icon, layout="wide")
BRAND = "#5088C0"
st.markdown(f"""<style>
.stApp .stButton>button, .stApp .stDownloadButton>button {{background:{BRAND};color:#fff;border:0;font-weight:700;}}
.stApp .stButton>button:hover, .stApp .stDownloadButton>button:hover {{background:#3D6FA3;color:#fff;}}
.stApp h1,.stApp h2,.stApp h3,.stApp h4 {{color:#17191C;}}
</style>""", unsafe_allow_html=True)

def show_logo(width=64):
    cols = st.columns([1, 9])
    if os.path.exists("favicon.png"):
        cols[0].image("favicon.png", width=width)
    cols[1].markdown(
        f"<div style='line-height:1.05;margin-top:6px'>"
        f"<span style='font-size:24px;font-weight:800;letter-spacing:1px;color:#17191C'>BASE "
        f"<span style='color:{BRAND}'>HEALTH</span></span><br>"
        f"<span style='font-size:10px;letter-spacing:3px;color:#8a93a0'>NOOSA</span></div>",
        unsafe_allow_html=True)

# ---------- simple password gate ----------
PASSWORD = st.secrets.get("app_password", "changeme")  # set this in Streamlit > Settings > Secrets
if "ok" not in st.session_state:
    st.session_state.ok = False
if not st.session_state.ok:
    show_logo(60)
    st.title("Athlete Report")
    pw = st.text_input("Enter password", type="password")
    if st.button("Enter"):
        st.session_state.ok = (pw == PASSWORD)
        if not st.session_state.ok:
            st.error("Wrong password.")
        else:
            st.rerun()
    st.stop()

# ---------- load norms ----------
@st.cache_data
def load_norms():
    with open("norms.json", encoding="utf-8") as f:
        return json.load(f)
NORMS = load_norms()

def parse(s):
    s = (s or "").strip().replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None

STATUS_COLOR = {"Green": "#2E7D32", "Amber": "#DD8800", "Red": "#C62828", "n/a": "#999"}

# ---------- tool mode (Screening vs Hamstring rehab vs ACL rehab) ----------
@st.cache_data
def load_ham():
    with open("hamstring_norms.json", encoding="utf-8") as f:
        return json.load(f)
HAM = load_ham()

@st.cache_data
def load_acl():
    with open("acl_norms.json", encoding="utf-8") as f:
        return json.load(f)
ACL = load_acl()

mode = st.sidebar.radio("Tool", ["Screening report", "Hamstring rehab", "ACL rehab"])
st.sidebar.divider()

def hamstring_page():
    show_logo(64)
    st.title("Hamstring Rehab & Return-to-Play")
    st.caption("Injured-limb tracking against rehab-phase targets. Pick the phase, then enter the injured-limb results.")
    st.sidebar.header("Athlete / injury")
    meta = dict(
        name=st.sidebar.text_input("Athlete name", key="h_name"),
        date=st.sidebar.text_input("Test date", key="h_date"),
        injured=st.sidebar.selectbox("Injured side", ["\u2014", "Left", "Right"], key="h_side"),
        clinician=st.sidebar.text_input("Clinician", key="h_clin"),
        doi=st.sidebar.text_input("Date of injury", key="h_doi"),
        weeks=st.sidebar.text_input("Weeks since injury", key="h_wks"),
        sport=st.sidebar.text_input("Sport", key="h_sport"),
        notes=st.sidebar.text_input("Notes", key="h_notes"))
    meta["injured"] = meta["injured"] if meta["injured"] != "\u2014" else ""
    st.sidebar.divider()
    phase = st.sidebar.selectbox("Rehab phase", HAM["phases"], index=len(HAM["phases"]) - 1, key="h_phase")
    st.sidebar.caption("Targets update to the selected phase. Metrics with no target this phase show n/a.")
    pnorms = HAM["norms"].get(phase, {})
    inputs = {}
    for g in HAM["groups"]:
        st.markdown(f"#### {g['title']}")
        for m in g["metrics"]:
            name = m["name"]
            tgt = "" if name in pnorms else " \u00b7 (no target this phase)"
            c0, c1, c2 = st.columns([3, 1.3, 1.3])
            c0.markdown(f"**{name}** \n<span style='color:#5A6573;font-size:12px'>{m['unit']}{tgt}</span>",
                        unsafe_allow_html=True)
            res = c1.text_input("Result", key="hr_" + name, label_visibility="collapsed", placeholder="injured")
            prev = c2.text_input("Previous", key="hp_" + name, label_visibility="collapsed", placeholder="previous")
            inputs[name] = {"result": parse(res), "previous": parse(prev)}
    groups = engine.build_ham_rows(inputs, phase, HAM)
    counts = engine.counts(groups)
    st.divider()
    st.subheader(f"Phase progress \u2014 {phase}")
    a, b, c = st.columns(3)
    a.metric("On / ahead", counts["Green"]); b.metric("Within 1 SD", counts["Amber"]); c.metric(">1 SD behind", counts["Red"])
    with st.expander("See all entered results"):
        for gp in groups:
            st.markdown(f"**{gp['title']}**")
            for r in gp["rows"]:
                col = STATUS_COLOR.get(r["status"], "#999")
                chg = f" \u00b7 {r['change']}" if r["change"] else ""
                st.markdown(
                    f"<span style='background:{col};color:#fff;border-radius:3px;padding:0 6px'>{r['status'] or '\u2014'}</span> "
                    f"{r['name']}: **{r['result']}** {r['unit']} (target {r['target']}){chg}", unsafe_allow_html=True)
    st.divider()
    if not groups:
        st.info("Enter at least one injured-limb result to generate the rehab report.")
    else:
        if st.button("Generate rehab PDF", type="primary", key="h_pdf"):
            pdf = report_pdf.render_ham_pdf(meta, phase, groups, counts, HAM.get("disclaimer", ""))
            fname = (meta.get("name") or "athlete").strip().replace(" ", "_") + "_hamstring.pdf"
            st.download_button("Download PDF", data=pdf, file_name=fname, mime="application/pdf", key="h_dl")
            st.success("Report ready — click Download PDF above.")

def acl_page():
    show_logo(64)
    st.title("ACL Rehab & Return-to-Play")
    st.caption("Injured-limb / symmetry tracking against ACLR research norms. "
               "Pick the rehab phase and the athlete's sex, then enter the results.")
    st.sidebar.header("Athlete / surgery")
    meta = dict(
        name=st.sidebar.text_input("Athlete name", key="a_name"),
        date=st.sidebar.text_input("Test date", key="a_date"),
        injured=st.sidebar.selectbox("Injured side", ["\u2014", "Left", "Right"], key="a_side"),
        surgeon=st.sidebar.text_input("Surgeon / clinician", key="a_surg"),
        graft=st.sidebar.text_input("Graft type", key="a_graft"),
        dos=st.sidebar.text_input("Date of surgery", key="a_dos"),
        months=st.sidebar.text_input("Months since surgery", key="a_mo"),
        sport=st.sidebar.text_input("Sport", key="a_sport"),
        notes=st.sidebar.text_input("Notes", key="a_notes"))
    meta["injured"] = meta["injured"] if meta["injured"] != "\u2014" else ""
    st.sidebar.divider()
    phase = st.sidebar.selectbox("Rehab phase", ACL["phases"],
                                 index=len(ACL["phases"]) - 1, key="a_phase")
    sex = st.sidebar.selectbox("Sex (norm set)", ACL["sexes"], key="a_sex")
    meta["sex"] = sex
    key = f"{phase}|{sex}"
    pnorms = ACL["norms"].get(key, {})
    if not pnorms:
        st.sidebar.warning(f"No {sex} norms for {phase} in the source report "
                           "(e.g. 9-month data is male-only). Results will show n/a.")
    st.sidebar.caption("Targets update to the selected phase & sex. "
                       "Metrics with no norm this phase show n/a.")
    inputs = {}
    for g in ACL["groups"]:
        st.markdown(f"#### {g['title']}")
        for m in g["metrics"]:
            name = m["name"]
            tgt = "" if name in pnorms else " \u00b7 (no norm this phase)"
            if m.get("calc") == "LSI":
                # Auto-calculated limb symmetry index: enter Left & Right, compute operated/non-operated.
                c0, cL, cR, cV = st.columns([2.6, 1.1, 1.1, 1.2])
                c0.markdown(f"**{name}** \n<span style='color:#5A6573;font-size:12px'>L vs R \u2192 auto LSI{tgt}</span>",
                            unsafe_allow_html=True)
                lv = cL.text_input("Left", key="al_" + name, label_visibility="collapsed", placeholder="Left")
                rv = cR.text_input("Right", key="arr_" + name, label_visibility="collapsed", placeholder="Right")
                left = parse(lv); right = parse(rv); op = meta.get("injured")
                lsi = None
                if left and right and op in ("Left", "Right"):
                    operated = left if op == "Left" else right
                    other = right if op == "Left" else left
                    lsi = round(operated / other * 100, 1) if other else None
                if lsi is not None:
                    stt = engine.status(lsi, pnorms.get(name))
                    col = STATUS_COLOR.get(stt, "#999")
                    cV.markdown(f"<div style='text-align:center'><span style='background:{col};color:#fff;"
                                f"border-radius:3px;padding:1px 8px;font-weight:700'>{lsi}%</span></div>",
                                unsafe_allow_html=True)
                elif op not in ("Left", "Right"):
                    cV.caption("set Injured side")
                else:
                    cV.caption("enter L & R")
                inputs[name] = {"result": lsi, "previous": None}
            else:
                c0, c1, c2 = st.columns([3, 1.3, 1.3])
                c0.markdown(f"**{name}** \n<span style='color:#5A6573;font-size:12px'>{m['unit']}{tgt}</span>",
                            unsafe_allow_html=True)
                res = c1.text_input("Result", key="ar_" + name, label_visibility="collapsed", placeholder="result")
                prev = c2.text_input("Previous", key="ap_" + name, label_visibility="collapsed", placeholder="previous")
                inputs[name] = {"result": parse(res), "previous": parse(prev)}
    groups = engine.build_ham_rows(inputs, key, ACL)
    counts = engine.counts(groups)
    st.divider()
    st.subheader(f"Phase progress \u2014 {phase} ({sex})")
    a, b, c = st.columns(3)
    a.metric("On / ahead", counts["Green"]); b.metric("Within 1 SD", counts["Amber"]); c.metric(">1 SD behind", counts["Red"])
    with st.expander("See all entered results"):
        for gp in groups:
            st.markdown(f"**{gp['title']}**")
            for r in gp["rows"]:
                col = STATUS_COLOR.get(r["status"], "#999")
                chg = f" \u00b7 {r['change']}" if r["change"] else ""
                st.markdown(
                    f"<span style='background:{col};color:#fff;border-radius:3px;padding:0 6px'>{r['status'] or '\u2014'}</span> "
                    f"{r['name']}: **{r['result']}** {r['unit']} (target {r['target']}){chg}", unsafe_allow_html=True)
    st.divider()
    if not groups:
        st.info("Enter at least one result to generate the ACL rehab report.")
    else:
        if st.button("Generate ACL PDF", type="primary", key="a_pdf"):
            pdf = report_pdf.render_acl_pdf(meta, phase, sex, groups, counts, ACL.get("disclaimer", ""))
            fname = (meta.get("name") or "athlete").strip().replace(" ", "_") + "_acl.pdf"
            st.download_button("Download PDF", data=pdf, file_name=fname, mime="application/pdf", key="a_dl")
            st.success("Report ready — click Download PDF above.")

if mode == "Hamstring rehab":
    hamstring_page()
    st.stop()

if mode == "ACL rehab":
    acl_page()
    st.stop()

# ---------- sidebar: athlete details + auto population ----------
GEN_M = "General Clinical \u2014 Male (all ages)"
GEN_F = "General Clinical \u2014 Female (all ages)"

def age_to_band(age):
    try:
        a = int(float(age))
    except (TypeError, ValueError):
        return "All ages"
    base = (a // 10) * 10
    return f"{base}-{base+10} years" if base in (10, 20, 30, 40, 50) else "All ages"

# ---- import from VALD Hub CSV (runs before the form so it can pre-fill it) ----
import vald_import
with st.sidebar.expander("\u2b06 Import from VALD Hub CSV"):
    st.caption("Upload one or more VALD exports (ForceDecks, NordBord, ForceFrame, DynaMo). "
               "Recognised metrics, plus Name, Date and Mass, pre-fill the form below.")
    up = st.file_uploader("VALD CSV export(s)", type="csv", accept_multiple_files=True, key="vald_files")
    if st.button("Load into form", key="vald_load"):
        if up:
            m_imp, r_imp, msgs = vald_import.parse_files([(f.name, f.getvalue()) for f in up])
            if m_imp.get("name"): st.session_state["sc_name"] = m_imp["name"]
            if m_imp.get("date"): st.session_state["sc_date"] = m_imp["date"]
            if m_imp.get("mass"): st.session_state["sc_mass"] = m_imp["mass"]
            if m_imp.get("sex") in ("Male", "Female"): st.session_state["sc_sex"] = m_imp["sex"]
            for metric, val in r_imp.items():
                st.session_state["r_" + metric] = str(val)
            st.session_state["vald_msg"] = msgs
            st.rerun()
        else:
            st.warning("Choose a CSV file first.")
if st.session_state.get("vald_msg"):
    for _m in st.session_state["vald_msg"]:
        st.sidebar.caption(_m)
    st.sidebar.caption("Review the pre-filled values, then set **Sex** and **Age** for age/sex norms.")

st.sidebar.header("Athlete details")
name = st.sidebar.text_input("Athlete name", key="sc_name")
date = st.sidebar.text_input("Test date", key="sc_date")
sex = st.sidebar.selectbox("Sex", ["\u2014", "Male", "Female"], key="sc_sex")
age = st.sidebar.text_input("Age (years)", key="sc_age")
sport = st.sidebar.text_input("Sport", key="sc_sport")
tester = st.sidebar.text_input("Tester", key="sc_tester")
mass = st.sidebar.text_input("Mass (kg)", key="sc_mass")
notes = st.sidebar.text_input("Notes", key="sc_notes")
meta = dict(name=name, date=date, sex=(sex if sex != "\u2014" else ""), age=age,
            sport=sport, tester=tester, mass=mass, notes=notes)
st.sidebar.divider()
st.sidebar.header("Compare against")
SPORTS = [p for p in NORMS["population_order"] if not p.startswith("General Clinical")]
choice = st.sidebar.selectbox("Reference population",
                              ["General population (auto by age & sex)"] + SPORTS)
if choice.startswith("General population"):
    population = GEN_M if sex == "Male" else (GEN_F if sex == "Female" else None)
    age_band = age_to_band(age)
    if population is None:
        pop_label = None
        st.sidebar.warning("Choose Sex to compare against the general norms.")
    else:
        base = "Male" if sex == "Male" else "Female"
        if age_band != "All ages":
            pop_label = f"General Clinical \u2014 {base} \u00b7 {age_band.replace(' years','')} yr"
            st.sidebar.success(f"Auto-selected: {base}, {age_band.replace(' years','')} yr")
        else:
            pop_label = f"General Clinical \u2014 {base} \u00b7 all ages"
            why = "no age entered" if not age.strip() else "age outside 10\u201360"
            st.sidebar.info(f"Auto-selected: {base}, all ages ({why}).")
        st.sidebar.caption("Jump/Nordic/hip metrics use the matched age band; IMTP & DSI stay all-ages. "
                           "Any metric without that band falls back to all-ages (shown per row).")
else:
    population = choice
    age_band = "All ages"
    pop_label = choice
    st.sidebar.caption("Sport populations are single-band (no age split).")

# ---------- main: data entry ----------
show_logo(64)
st.title("Athlete Performance & Readiness Report")
st.caption("Enter this test's result, and (optional) the previous result to track change. Leave a metric blank to skip it.")
inputs = {}

def is_asym(n):
    return ("Asymmetry" in n) or ("Imbalance" in n)

for g in NORMS["groups"]:
    st.markdown(f"#### {g['title']}")
    for m in g["metrics"]:
        if m["calc"] == "DSI":
            st.caption("DSI is calculated automatically from CMJ Peak Force \u00f7 IMTP Peak Force.")
            continue
        name = m["name"]
        if is_asym(name):
            c0, c1, cs, c2 = st.columns([3, 1.2, 1.0, 1.2])
            c0.markdown(f"**{name}** \n<span style='color:#5A6573;font-size:12px'>{m['unit']} \u00b7 higher side</span>",
                        unsafe_allow_html=True)
            res = c1.text_input("Result", key="r_" + name, label_visibility="collapsed", placeholder="result")
            side = cs.selectbox("Side", ["\u2014", "L", "R"], key="s_" + name, label_visibility="collapsed")
            prev = c2.text_input("Previous", key="p_" + name, label_visibility="collapsed", placeholder="previous")
            inputs[name] = {"result": parse(res), "previous": parse(prev),
                            "side": (side if side in ("L", "R") else "")}
        else:
            c0, c1, c2 = st.columns([3, 1.3, 1.3])
            uhint = "N \u00b7 enter force, scored as \u00d7 BW via Mass" if m["calc"] in ("PERKG", "PERBW") else m["unit"]
            c0.markdown(f"**{name}** \n<span style='color:#5A6573;font-size:12px'>{uhint}</span>",
                        unsafe_allow_html=True)
            res = c1.text_input("Result", key="r_" + name, label_visibility="collapsed", placeholder="result")
            prev = c2.text_input("Previous", key="p_" + name, label_visibility="collapsed", placeholder="previous")
            inputs[name] = {"result": parse(res), "previous": parse(prev)}

# ---------- compute ----------
if population is None:
    groups, counts, prios = [], {"Green": 0, "Amber": 0, "Red": 0}, []
else:
    groups = engine.build_rows(inputs, population, NORMS, age_band, parse(meta.get("mass")))
    counts = engine.counts(groups)
    prios = engine.priorities(groups)

st.divider()
st.subheader("Live summary")
a, b, c = st.columns(3)
a.metric("Green", counts["Green"]); b.metric("Amber", counts["Amber"]); c.metric("Red", counts["Red"])
st.markdown("**Top priorities (worst first)**")
if prios:
    for r in prios:
        col = STATUS_COLOR.get(r["status"], "#999")
        sd = f" <b>({r['side']} higher)</b>" if r.get("side") else ""
        st.markdown(
            f"<span style='background:{col};color:#fff;border-radius:3px;padding:1px 7px;font-weight:700'>{r['status']}</span> "
            f"**{r['name']}** &nbsp; = {r['result']} {r['unit']}{sd} · needs {r['target']}",
            unsafe_allow_html=True)
else:
    st.success("Nothing flagged — all tested metrics on target.")

with st.expander("See all entered results"):
    for gp in groups:
        st.markdown(f"**{gp['title']}**")
        for r in gp["rows"]:
            col = STATUS_COLOR.get(r["status"], "#999")
            chg = f" · {r['change']}" if r["change"] else ""
            sd = f" ({r['side']} higher)" if r.get("side") else ""
            st.markdown(
                f"<span style='background:{col};color:#fff;border-radius:3px;padding:0 6px'>{r['status'] or '—'}</span> "
                f"{r['name']}: **{r['result']}** {r['unit']}{sd} (target {r['target']}){chg}",
                unsafe_allow_html=True)

# ---------- generate PDF ----------
st.divider()
if population is None:
    st.info("Choose **Sex** in the sidebar (or pick a sport population) to compare against norms.")
elif not groups:
    st.info("Enter at least one result above to generate a report.")
else:
    if st.button("Generate PDF report", type="primary"):
        pdf = report_pdf.render_pdf(meta, pop_label, groups, counts, prios)
        fname = (meta.get("name") or "athlete").strip().replace(" ", "_") + "_report.pdf"
        st.download_button("Download PDF", data=pdf, file_name=fname, mime="application/pdf")
        st.success("Report ready — click Download PDF above.")
