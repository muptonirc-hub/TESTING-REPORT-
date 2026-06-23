# ============================================================================
#  ACL REHAB ADD-ON for app.py
#  Four edits. Search for the >>> markers below for exactly where each goes.
# ============================================================================

# ---------------------------------------------------------------------------
# EDIT 1.  Replace the existing Tool radio line:
#     mode = st.sidebar.radio("Tool", ["Screening report", "Hamstring rehab"])
# with:
# ---------------------------------------------------------------------------
mode = st.sidebar.radio("Tool", ["Screening report", "Hamstring rehab", "ACL rehab"])


# ---------------------------------------------------------------------------
# EDIT 2.  Just below the existing  HAM = load_ham()  line, add:
# ---------------------------------------------------------------------------
@st.cache_data
def load_acl():
    with open("acl_norms.json", encoding="utf-8") as f:
        return json.load(f)

ACL = load_acl()


# ---------------------------------------------------------------------------
# EDIT 3.  Add this whole function next to hamstring_page()
#          (anywhere after STATUS_COLOR is defined and before the dispatch).
# ---------------------------------------------------------------------------
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
        # only show a group if at least one of its metrics has a norm this phase|sex
        shown = [m for m in g["metrics"] if m["name"] in pnorms] or g["metrics"]
        st.markdown(f"#### {g['title']}")
        for m in g["metrics"]:
            name = m["name"]
            tgt = "" if name in pnorms else " \u00b7 (no norm this phase)"
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
            st.download_button("Download PDF", data=pdf, file_name=fname,
                               mime="application/pdf", key="a_dl")
            st.success("Report ready \u2014 click Download PDF above.")


# ---------------------------------------------------------------------------
# EDIT 4.  Right after the existing hamstring dispatch:
#     if mode == "Hamstring rehab":
#         hamstring_page()
#         st.stop()
# add:
# ---------------------------------------------------------------------------
if mode == "ACL rehab":
    acl_page()
    st.stop()
