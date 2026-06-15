"""
VALD Athlete Report — type-in web app.
Enter results, see traffic lights live, download the premium PDF.
"""
import json
import streamlit as st
import engine
import report_pdf

st.set_page_config(page_title="VALD Athlete Report", page_icon="\U0001F3C3", layout="wide")

# ---------- simple password gate ----------
PASSWORD = st.secrets.get("app_password", "changeme")   # set this in Streamlit > Settings > Secrets
if "ok" not in st.session_state:
    st.session_state.ok = False
if not st.session_state.ok:
    st.title("VALD Athlete Report")
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

# ---------- sidebar: population + athlete details ----------
st.sidebar.header("Setup")
population = st.sidebar.selectbox("Compare against", NORMS["population_order"])
st.sidebar.caption("Pick the reference population. Metrics it doesn't cover show 'n/a'.")
st.sidebar.divider()
st.sidebar.subheader("Athlete details")
meta = dict(
    name=st.sidebar.text_input("Athlete name"),
    date=st.sidebar.text_input("Test date"),
    sport=st.sidebar.text_input("Sport"),
    tester=st.sidebar.text_input("Tester"),
    age=st.sidebar.text_input("Age"),
    mass=st.sidebar.text_input("Mass (kg)"),
    notes=st.sidebar.text_input("Notes"),
)

# ---------- main: data entry ----------
st.title("Athlete Performance & Readiness Report")
st.caption("Enter this test's result, and (optional) the previous result to track change. Leave a metric blank to skip it.")

inputs = {}
for g in NORMS["groups"]:
    st.markdown(f"#### {g['title']}")
    for m in g["metrics"]:
        if m["calc"] == "DSI":
            st.caption("DSI is calculated automatically from CMJ Peak Force \u00f7 IMTP Peak Force.")
            continue
        c0, c1, c2 = st.columns([3, 1.3, 1.3])
        c0.markdown(f"**{m['name']}**  \n<span style='color:#5A6573;font-size:12px'>{m['unit']}</span>",
                    unsafe_allow_html=True)
        res = c1.text_input("Result", key="r_" + m["name"], label_visibility="collapsed", placeholder="result")
        prev = c2.text_input("Previous", key="p_" + m["name"], label_visibility="collapsed", placeholder="previous")
        inputs[m["name"]] = {"result": parse(res), "previous": parse(prev)}

# ---------- compute ----------
groups = engine.build_rows(inputs, population, NORMS)
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
        st.markdown(
            f"<span style='background:{col};color:#fff;border-radius:3px;padding:1px 7px;font-weight:700'>{r['status']}</span> "
            f"**{r['name']}** &nbsp; = {r['result']} {r['unit']} · needs {r['target']}",
            unsafe_allow_html=True)
else:
    st.success("Nothing flagged — all tested metrics on target.")

with st.expander("See all entered results"):
    for gp in groups:
        st.markdown(f"**{gp['title']}**")
        for r in gp["rows"]:
            col = STATUS_COLOR.get(r["status"], "#999")
            chg = f" · {r['change']}" if r["change"] else ""
            st.markdown(
                f"<span style='background:{col};color:#fff;border-radius:3px;padding:0 6px'>{r['status'] or '—'}</span> "
                f"{r['name']}: **{r['result']}** {r['unit']} (target {r['target']}){chg}",
                unsafe_allow_html=True)

# ---------- generate PDF ----------
st.divider()
if not groups:
    st.info("Enter at least one result above to generate a report.")
else:
    if st.button("Generate PDF report", type="primary"):
        pdf = report_pdf.render_pdf(meta, population, groups, counts, prios)
        fname = (meta.get("name") or "athlete").strip().replace(" ", "_") + "_report.pdf"
        st.download_button("Download PDF", data=pdf, file_name=fname, mime="application/pdf")
        st.success("Report ready — click Download PDF above.")
