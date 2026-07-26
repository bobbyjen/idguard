/* IDGuard — frontend app
   Loaded as an external script after vendor/react.js, vendor/react-dom.js, vendor/htm.js */
(function () {
  'use strict';

  // Vendor bundles are generated at Docker build time and are gitignored, so
  // "they didn't get staged" is a real deployment failure. Without this guard
  // the next line throws, the LOADING placeholder never clears, and the page
  // gives no clue which file is missing.
  var missing = [];
  if (typeof React    === "undefined") missing.push("/vendor/react.js");
  if (typeof ReactDOM === "undefined") missing.push("/vendor/react-dom.js");
  if (typeof htm      === "undefined") missing.push("/vendor/htm.js");
  if (missing.length) {
    var detail = "These scripts did not load: " + missing.join(", ") +
      ". If you opened index.html directly from disk, serve it over HTTP instead — " +
      "the app loads its scripts from absolute paths.";
    if (window.idguardBootError) window.idguardBootError(detail);
    else document.getElementById("boot").textContent = detail;
    console.error("IDGuard: " + detail);
    return;
  }

  const { useState, useEffect, useCallback } = React;
  const html = htm.bind(React.createElement);

  // ── Constants ──────────────────────────────────────────────────────────
  const DOC_TYPES = [
    { id:"us_passport",      label:"US Passport",      color:"#3b82f6", icon:"🛂" },
    { id:"us_passport_card", label:"Passport Card",     color:"#8b5cf6", icon:"🪪" },
    { id:"drivers_license",  label:"Driver's License",  color:"#f59e0b", icon:"🚗" },
    { id:"real_id",          label:"REAL ID",           color:"#10b981", icon:"⭐" },
    { id:"global_entry",     label:"Global Entry",      color:"#06b6d4", icon:"✈️" },
    { id:"nexus",            label:"NEXUS Card",        color:"#ec4899", icon:"🔑" },
    { id:"tsa_precheck",     label:"TSA PreCheck",      color:"#64748b", icon:"🔵" },
    { id:"green_card",       label:"Green Card / PR",   color:"#22c55e", icon:"🟢" },
    { id:"military_id",      label:"Military ID",       color:"#94a3b8", icon:"🎖️" },
    { id:"other",            label:"Other ID",          color:"#71717a", icon:"📄" },
  ];
  const ADV = [365, 180, 90, 60, 30, 14, 7];

  // ── Utilities ──────────────────────────────────────────────────────────
  const dateStr   = s => s ? s.split("T")[0] : "";
  const daysUntil = s => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.floor((new Date(dateStr(s) + "T00:00:00") - now) / 86400000);
  };
  const statusFor = d => {
    if (d < 0)   return { lbl:"EXPIRED",  clr:"#ef4444", bg:"rgba(239,68,68,.08)",  ring:"#ef4444" };
    if (d <= 30)  return { lbl:"CRITICAL", clr:"#ef4444", bg:"rgba(239,68,68,.08)",  ring:"#ef4444" };
    if (d <= 90)  return { lbl:"WARNING",  clr:"#f59e0b", bg:"rgba(245,158,11,.08)", ring:"#f59e0b" };
    if (d <= 180) return { lbl:"NOTICE",   clr:"#60a5fa", bg:"rgba(96,165,250,.08)", ring:"#60a5fa" };
    return { lbl:"VALID", clr:"#22c55e", bg:"rgba(34,197,94,.08)", ring:"#22c55e" };
  };
  const fmtDate = s => new Date(dateStr(s) + "T00:00:00").toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" });

  // ── Alert result copy ──────────────────────────────────────────────────
  // The server's sendAlerts() already returns per-channel status:
  //   { email: "sent" | "error: …" | null, sms: "sent" | "error: …" | "skipped: …" | null }
  // Report each channel by name instead of collapsing everything that isn't a
  // clean email success into "check server logs" — the people using this are
  // family members, not operators.
  //
  //   email    sms      → message                                    colour
  //   ───────  ───────  ─────────────────────────────────────────────  ──────
  //   sent     sent     ✓ Email sent · SMS sent                       green
  //   sent     error    Email sent · SMS failed — check server logs   amber
  //   sent     skipped  Email sent · SMS skipped (not configured)     amber
  //   error    —        Email failed — check server logs              red
  //   null     null     No alert channels are configured…             amber
  function describeAlertResults(results) {
    const r = results || {};
    const stateOf = v => {
      if (v === "sent") return "sent";
      if (typeof v === "string" && v.indexOf("skipped") === 0) return "skipped";
      if (typeof v === "string") return "failed";
      return "off";
    };
    const e = stateOf(r.email), s = stateOf(r.sms);

    if (e === "off" && s === "off") {
      return { msg: "No alert channels are configured for this document", color: "#f59e0b" };
    }

    const bits = [];
    if (e !== "off") bits.push("Email " + e);
    if (s !== "off") bits.push("SMS " + s);

    const anyFailed  = e === "failed"  || s === "failed";
    const anySkipped = e === "skipped" || s === "skipped";
    const anySent    = e === "sent"    || s === "sent";

    const suffix = anyFailed ? " — check server logs" : anySkipped ? " (not configured)" : "";
    const color  = anyFailed ? (anySent ? "#f59e0b" : "#ef4444") : anySkipped ? "#f59e0b" : "#22c55e";
    const prefix = !anyFailed && !anySkipped ? "✓ " : "";

    return { msg: prefix + bits.join(" · ") + suffix, color };
  }

  // ── API ────────────────────────────────────────────────────────────────
  async function api(path, opts = {}) {
    const res  = await fetch("/api" + path, { headers:{ "Content-Type":"application/json" }, ...opts });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  // ── Countdown Ring ─────────────────────────────────────────────────────
  function Ring({ days }) {
    const st   = statusFor(days);
    const prog = days < 0 ? 0 : Math.min(days / 365, 1);
    const R    = 31, circ = 2 * Math.PI * R, off = circ * (1 - prog);
    const numStyle = { fontFamily:"'DM Mono',monospace", fontSize: days > 999 || days < -9 ? "11px" : "13.5px", fontWeight:"500" };
    const lblStyle = { fontFamily:"'DM Sans',sans-serif", fontSize:"7px", letterSpacing:"1.1px" };
    return html`
      <svg width="78" height="78" viewBox="0 0 78 78" style=${{ flexShrink:0 }}>
        <circle cx="39" cy="39" r=${R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="5"/>
        <circle cx="39" cy="39" r=${R} fill="none" stroke=${st.ring} strokeWidth="5"
          strokeDasharray=${circ} strokeDashoffset=${off} strokeLinecap="round"
          transform="rotate(-90 39 39)" style=${{ transition:"all 1s ease" }}/>
        <text x="39" y="36" textAnchor="middle" dominantBaseline="middle" fill=${st.clr} style=${numStyle}>
          ${days < 0 ? "!" : days > 999 ? "999+" : days}
        </text>
        <text x="39" y="52" textAnchor="middle" fill="rgba(255,255,255,0.28)" style=${lblStyle}>
          ${days < 0 ? "EXPIRED" : "DAYS"}
        </text>
      </svg>
    `;
  }

  // ── Document Card ──────────────────────────────────────────────────────
  function DocCard({ doc, onEdit, onDelete, onTestAlert }) {
    const [testing, setTesting] = useState(false);
    const days       = daysUntil(doc.expiry_date);
    const st         = statusFor(days);
    const dt         = DOC_TYPES.find(t => t.id === doc.doc_type) || DOC_TYPES[DOC_TYPES.length - 1];
    const isPassport = doc.doc_type === "us_passport" || doc.doc_type === "us_passport_card";
    const travelDays = isPassport ? days - 180 : null;

    const handleTest = async () => {
      setTesting(true);
      await onTestAlert(doc.id);
      setTesting(false);
    };

    return html`
      <div class="dc" style=${{ "--_accent": st.ring }}>
        <div class="dc-top">
          <div class="dicon" style=${{ background: dt.color + "18", border: "1px solid " + dt.color + "28" }}>
            ${dt.icon}
          </div>
          <span class="badge" style=${{ color:st.clr, borderColor:st.clr + "44", background:st.bg }}>
            ${st.lbl}
          </span>
        </div>
        <div class="dc-mid">
          <div style=${{ flex:1, minWidth:0 }}>
            <div class="dname">${doc.holder_name}</div>
            <div class="dtype">${dt.label}</div>
          </div>
          <${Ring} days=${days}/>
        </div>
        <div class="dc-bot">
          <div>
            <div class="dexp">Expires ${fmtDate(doc.expiry_date)}</div>
            ${isPassport && travelDays !== null && html`
              <div class="tnote">
                ✈️ ${travelDays > 0 ? "Intl. travel safe " + travelDays + "d more" : "⚠ Not safe for international travel"}
              </div>
            `}
            ${doc.alert_email && html`<div class="demail">✉ ${doc.alert_email}</div>`}
          </div>
          <div class="acts">
            <button class=${"ab test" + (testing ? " sending" : "")} onClick=${handleTest}
              title="Send test alert" aria-label=${"Send test alert for " + doc.holder_name + "'s " + dt.label}>📧</button>
            <button class="ab" onClick=${() => onEdit(doc)}
              title="Edit" aria-label=${"Edit " + doc.holder_name + "'s " + dt.label}>✏️</button>
            <button class="ab del" onClick=${() => onDelete(doc.id)}
              title="Delete" aria-label=${"Delete " + doc.holder_name + "'s " + dt.label}>🗑️</button>
          </div>
        </div>
      </div>
    `;
  }

  // ── Add / Edit Modal ───────────────────────────────────────────────────
  function Modal({ doc, onSave, onClose, saving }) {
    const blank = {
      doc_type:"us_passport", holder_name:"", expiry_date:"", doc_number:"",
      alert_email:"", alert_phone:"", alert_channels:["email"],
      alert_advance_days:[180, 90, 30, 7], notes:""
    };
    const [f, setF] = useState(doc ? {
      ...doc,
      expiry_date:        dateStr(doc.expiry_date),
      alert_channels:     Array.isArray(doc.alert_channels)     ? doc.alert_channels     : ["email"],
      alert_advance_days: Array.isArray(doc.alert_advance_days) ? doc.alert_advance_days : [180, 90, 30, 7],
    } : blank);

    // Required-field errors stay hidden until a field is blurred or the user
    // attempts to save, so nothing shouts at someone who hasn't typed yet.
    const [touched, setTouched] = useState({});

    const set    = (k, v) => setF(p => Object.assign({}, p, { [k]: v }));
    const mark   = k => setTouched(p => Object.assign({}, p, { [k]: true }));
    const togCh  = c => set("alert_channels",     f.alert_channels.includes(c)     ? f.alert_channels.filter(x => x !== c)     : f.alert_channels.concat(c));
    const togDay = d => set("alert_advance_days", f.alert_advance_days.includes(d) ? f.alert_advance_days.filter(x => x !== d) : f.alert_advance_days.concat(d).sort((a,b) => b - a));

    const errors = {
      holder_name: f.holder_name.trim() ? null : "Holder name is required",
      expiry_date: f.expiry_date        ? null : "Expiry date is required",
    };
    const errFor  = k => (touched[k] ? errors[k] : null);
    const isValid = !errors.holder_name && !errors.expiry_date;

    // The button stays clickable while invalid: a disabled button that never
    // says why is the exact problem this change exists to fix.
    const attemptSave = () => {
      if (!isValid) { setTouched({ holder_name: true, expiry_date: true }); return; }
      onSave(f);
    };

    return html`
      <div class="ov" onClick=${e => e.target === e.currentTarget && onClose()}>
        <div class="modal">
          <div class="mh">
            <div class="mtitle">${doc ? "Edit Document" : "Add Document"}</div>
            <button class="xb" onClick=${onClose} title="Close" aria-label="Close dialog">×</button>
          </div>

          <div class="fg">
            <label class="fl">Document Type</label>
            <select class="fs" value=${f.doc_type} onChange=${e => set("doc_type", e.target.value)}>
              ${DOC_TYPES.map(t => html`<option key=${t.id} value=${t.id}>${t.icon}  ${t.label}</option>`)}
            </select>
          </div>

          <div class="fg">
            <label class="fl">Holder Name</label>
            <input class=${"fi" + (errFor("holder_name") ? " err" : "")} placeholder="Full name as on document"
              aria-label="Holder name" aria-invalid=${errFor("holder_name") ? "true" : null}
              value=${f.holder_name} onBlur=${() => mark("holder_name")}
              onChange=${e => set("holder_name", e.target.value)}/>
            ${errFor("holder_name") && html`<span class="ferr">${errFor("holder_name")}</span>`}
          </div>

          <div class="fr">
            <div class="fg">
              <label class="fl">Expiry Date</label>
              <input class=${"fi" + (errFor("expiry_date") ? " err" : "")} type="date"
                aria-label="Expiry date" aria-invalid=${errFor("expiry_date") ? "true" : null}
                value=${f.expiry_date} onBlur=${() => mark("expiry_date")}
                onChange=${e => set("expiry_date", e.target.value)}/>
              ${errFor("expiry_date") && html`<span class="ferr">${errFor("expiry_date")}</span>`}
            </div>
            <div class="fg">
              <label class="fl">Doc # (optional)</label>
              <input class="fi" placeholder="e.g. A12345678"
                value=${f.doc_number || ""} onChange=${e => set("doc_number", e.target.value)}/>
            </div>
          </div>

          <div class="sep">
            <div class="fl" style=${{ marginBottom:"10px" }}>Alert Channels</div>
            <div class="cg">
              ${[{id:"email",lbl:"📧  Email"},{id:"sms",lbl:"💬  SMS"}].map(c => html`
                <div key=${c.id} class=${"ci" + (f.alert_channels.includes(c.id) ? " ck" : "")}
                  onClick=${() => togCh(c.id)}>
                  ${f.alert_channels.includes(c.id) ? "✓ " : ""}${c.lbl}
                </div>
              `)}
            </div>
          </div>

          ${f.alert_channels.includes("email") && html`
            <div class="fg">
              <label class="fl">Alert Email</label>
              <input class="fi" type="email" placeholder="your@email.com"
                value=${f.alert_email} onChange=${e => set("alert_email", e.target.value)}/>
            </div>
          `}
          ${f.alert_channels.includes("sms") && html`
            <div class="fg">
              <label class="fl">Phone (SMS)</label>
              <input class="fi" type="tel" placeholder="+1 (555) 000-0000"
                value=${f.alert_phone || ""} onChange=${e => set("alert_phone", e.target.value)}/>
            </div>
          `}

          <div class="fg">
            <label class="fl">Alert me this many days before expiry</label>
            <div class="dg" style=${{ marginTop:"8px" }}>
              ${ADV.map(d => html`
                <button key=${d} class=${"dc2" + (f.alert_advance_days.includes(d) ? " on" : "")}
                  onClick=${() => togDay(d)}>${d}d</button>
              `)}
            </div>
          </div>

          <div class="fg">
            <label class="fl">Notes (optional)</label>
            <input class="fi" placeholder="e.g. Stored in fireproof safe"
              value=${f.notes || ""} onChange=${e => set("notes", e.target.value)}/>
          </div>

          <div class="ma">
            <button class="bts" onClick=${onClose}>Cancel</button>
            <button class="btp" disabled=${saving} onClick=${attemptSave}>
              ${saving ? "Saving…" : doc ? "Save Changes" : "Add Document"}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ── Settings View ──────────────────────────────────────────────────────
  function SettingsView({ docs }) {
    const rows = [
      { icon:"📅", title:"Daily scheduler",       desc:"Runs every morning at 9 AM, checks all expiry dates against each document's configured advance-day thresholds." },
      { icon:"📧", title:"Email via Gmail",        desc:"HTML reminder emails sent from your Gmail account. Click 📧 on any card to send a test alert immediately." },
      { icon:"💬", title:"SMS via Twilio",         desc:"Text message reminders. Replace the placeholder Twilio secrets and rebuild to activate." },
      { icon:"✈️", title:"Passport 6-month rule", desc:"For US passports, IDGuard shows your safe international travel window — most countries require 6 months of validity beyond your return date." },
      { icon:"🔒", title:"Self-hosted by design",  desc:"Your documents stay on your own server. Alerts go out through your own Gmail and Twilio accounts, never through a third-party IDGuard service." },
    ];
    return html`
      <div>
        <div class="ph">
          <div class="ptitle">Set<em>tings</em></div>
          <div class="psub">System info and document summary</div>
        </div>
        <div class="stitle">How IDGuard works</div>
        <div class="sdesc">A daily scheduler checks expiry dates and sends alerts via Gmail and optionally SMS.</div>
        <div class="scard">
          ${rows.map((r, i) => html`
            <div key=${i} class="srow">
              <span style=${{ fontSize:"20px", flexShrink:0, width:"28px", textAlign:"center" }}>${r.icon}</span>
              <div>
                <div class="srtitle">${r.title}</div>
                <div class="srdesc">${r.desc}</div>
              </div>
            </div>
          `)}
        </div>
        <div class="stitle">Tracked documents (${docs.length})</div>
        <div class="sdesc">All documents currently stored in the database.</div>
        ${docs.length > 0 ? html`
          <div class="scard">
            ${docs.map((d, i) => {
              const days = daysUntil(d.expiry_date), st = statusFor(days);
              const dt   = DOC_TYPES.find(t => t.id === d.doc_type) || DOC_TYPES[DOC_TYPES.length - 1];
              const chs  = Array.isArray(d.alert_channels)     ? d.alert_channels     : ["email"];
              const adv  = Array.isArray(d.alert_advance_days) ? d.alert_advance_days : [180, 90, 30, 7];
              return html`
                <div key=${d.id} style=${{
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"11px 0", borderBottom: i < docs.length - 1 ? "1px solid var(--b1)" : "none"
                }}>
                  <div style=${{ display:"flex", gap:"10px", alignItems:"center" }}>
                    <span style=${{ fontSize:"16px" }}>${dt.icon}</span>
                    <div>
                      <div style=${{ fontSize:"13.5px", fontWeight:"500" }}>${d.holder_name}</div>
                      <div style=${{ fontSize:"10.5px", color:"var(--t2)" }}>
                        ${chs.join(", ")} · alerts at ${adv.join("d, ")}d
                      </div>
                    </div>
                  </div>
                  <span class="badge" style=${{ color:st.clr, borderColor:st.clr + "44", background:st.bg }}>
                    ${st.lbl}
                  </span>
                </div>
              `;
            })}
          </div>
        ` : html`
          <div class="scard" style=${{ color:"var(--t2)", fontSize:"13px" }}>No documents added yet.</div>
        `}
      </div>
    `;
  }

  // ── Main App ───────────────────────────────────────────────────────────
  function IDGuardApp() {
    const [docs,    setDocs]    = useState([]);
    const [view,    setView]    = useState("dash");
    const [modal,   setModal]   = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving,  setSaving]  = useState(false);
    const [error,   setError]   = useState(null);
    const [toast,   setToast]   = useState(null);

    const showToast = (msg, color) => {
      setToast({ msg, color: color || "#22c55e" });
      setTimeout(() => setToast(null), 3500);
    };

    const loadDocs = useCallback(async () => {
      try {
        const data = await api("/documents");
        setDocs(data.sort((a, b) => daysUntil(a.expiry_date) - daysUntil(b.expiry_date)));
        setError(null);
      } catch (err) {
        setError("Could not reach the server: " + err.message);
      }
    }, []);

    useEffect(() => { loadDocs().finally(() => setLoading(false)); }, [loadDocs]);

    const saveDoc = async f => {
      setSaving(true);
      try {
        if (f.id) {
          await api("/documents/" + f.id, { method:"PUT",  body:JSON.stringify(f) });
          showToast("Document updated");
        } else {
          await api("/documents",          { method:"POST", body:JSON.stringify(f) });
          showToast("Document added");
        }
        await loadDocs();
        setModal(null);
      } catch (err) {
        showToast("Error: " + err.message, "#ef4444");
      } finally {
        setSaving(false);
      }
    };

    const delDoc = async id => {
      if (!window.confirm("Remove this document?")) return;
      try {
        await api("/documents/" + id, { method:"DELETE" });
        await loadDocs();
        showToast("Document removed");
      } catch (err) {
        showToast("Error: " + err.message, "#ef4444");
      }
    };

    const testAlert = async id => {
      try {
        const res = await api("/documents/" + id + "/test-alert", { method:"POST" });
        const outcome = describeAlertResults(res.results);
        showToast(outcome.msg, outcome.color);
      } catch (err) {
        showToast("Alert failed: " + err.message, "#ef4444");
      }
    };

    const expired  = docs.filter(d => daysUntil(d.expiry_date) < 0).length;
    const critical = docs.filter(d => { const x = daysUntil(d.expiry_date); return x >= 0 && x <= 30; }).length;
    const urgent   = expired + critical;
    const nextDays = docs.length > 0 ? daysUntil(docs[0].expiry_date) : null;

    if (loading) return null;

    return html`
      <div class="shell">
        <nav class="sidebar" aria-label="Main navigation">
          <div class="logo" aria-hidden="true">🛂</div>
          <div class="wordmark">IDGuard</div>
          <button class=${"nb" + (view === "dash" ? " on" : "")} onClick=${() => setView("dash")}
            title="Dashboard" aria-label="Dashboard" aria-current=${view === "dash" ? "page" : null}>⊞</button>
          <button class=${"nb" + (view === "settings" ? " on" : "")} onClick=${() => setView("settings")}
            title="Settings" aria-label="Settings" aria-current=${view === "settings" ? "page" : null}>⚙</button>
          <span class="spc"/>
          <button class="nb" title="Refresh" aria-label="Refresh documents" onClick=${loadDocs}>↻</button>
        </nav>

        <main class="main">
          ${error && html`
            <div class="errbanner">
              <span>⚠ ${error}</span>
              <button onClick=${loadDocs}
                style=${{ background:"none", border:"none", color:"#60a5fa", cursor:"pointer", fontSize:"13px" }}>
                Retry
              </button>
            </div>
          `}

          ${urgent > 0 && view === "dash" && html`
            <div class="banner">
              <span class="pulse" style=${{ fontSize:"18px" }}>🚨</span>
              <div class="btext">
                <strong>${urgent} document${urgent !== 1 ? "s" : ""} need${urgent === 1 ? "s" : ""} urgent attention</strong>
                <span>Renew before your next trip to avoid being turned away.</span>
              </div>
            </div>
          `}

          ${view === "dash" && html`
            <div>
              <div class="ph">
                <div class="ptitle">ID<em>Guard</em></div>
                <div class="psub">
                  ${docs.length === 0
                    ? "Track your travel documents — never get caught at the gate"
                    : urgent > 0
                      ? urgent + " need attention — act now"
                      : "All " + docs.length + " document" + (docs.length !== 1 ? "s" : "") + " valid"}
                </div>
              </div>

              ${docs.length > 0 && html`
                <div class="stats">
                  <div class="sc"><div class="sv" style=${{ color:"var(--t1)" }}>${docs.length}</div><div class="sl">Total</div></div>
                  <div class="sc"><div class="sv" style=${{ color: expired  > 0 ? "#ef4444" : "var(--grey)" }}>${expired}</div><div class="sl">Expired</div></div>
                  <div class="sc"><div class="sv" style=${{ color: critical > 0 ? "#ef4444" : "var(--grey)" }}>${critical}</div><div class="sl">Critical (&lt;30d)</div></div>
                  <div class="sc">
                    <div class="sv" style=${{ color: nextDays !== null && nextDays >= 0 ? "#22c55e" : "var(--grey)" }}>
                      ${nextDays !== null && nextDays >= 0 ? nextDays : "—"}
                    </div>
                    <div class="sl">Days to Next</div>
                  </div>
                </div>
              `}

              ${docs.length === 0 ? html`
                <div class="empty">
                  <span style=${{ fontSize:"44px", opacity:.2 }}>✈️</span>
                  <div class="etitle">No documents tracked</div>
                  <div class="etext">Add your passport, driver's license, or other IDs. IDGuard will alert you via email or SMS well before they expire.</div>
                  <button class="btp" style=${{ marginTop:"22px" }} onClick=${() => setModal({})}>+ Add First Document</button>
                </div>
              ` : html`
                <div class="grid">
                  ${docs.map(d => html`
                    <${DocCard} key=${d.id} doc=${d}
                      onEdit=${d => setModal(d)}
                      onDelete=${delDoc}
                      onTestAlert=${testAlert}/>
                  `)}
                </div>
              `}
            </div>
          `}

          ${view === "settings" && html`<${SettingsView} docs=${docs}/>`}
        </main>

        ${view === "dash" && html`
          <button class="fab" onClick=${() => setModal({})} title="Add document" aria-label="Add document">+</button>
        `}

        ${modal !== null && html`
          <${Modal}
            doc=${modal.id ? modal : null}
            onSave=${saveDoc}
            onClose=${() => setModal(null)}
            saving=${saving}/>
        `}

        ${toast && html`
          <div class="toast" style=${{ color:toast.color, borderColor:toast.color + "40" }}>
            ${toast.msg}
          </div>
        `}
      </div>
    `;
  }

  // ── Boot ───────────────────────────────────────────────────────────────
  document.getElementById("boot").style.display = "none";
  document.getElementById("root").style.display = "flex";
  ReactDOM.createRoot(document.getElementById("root")).render(html`<${IDGuardApp}/>`);
  window.__IDGUARD_BOOTED__ = true;  // stands down the boot-check.js watchdog

})();
