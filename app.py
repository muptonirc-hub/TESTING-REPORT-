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
PASSWORD = st.secrets.get("app_password", "changeme")   # set this in Streamlit > Settings > Secrets
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
show_logo(64)
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
