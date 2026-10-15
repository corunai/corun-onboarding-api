/* Carrier onboarding. FMCSA screens call the live API. Phone, Motive, uploads, and invites stay in this browser. */
(function () {
  const C = window.CoRun;
  const KEY = "corun.carrier.onboarding.v1";
  const TOTAL = 8;
  const TITLES = [
    ["Account & company", "Just the basics. We'll read the rest from the USDOT or MC number.", ""],
    ["Verify phone", "Demo only — prove the screen, not the phone.", "DEMO"],
    ["FMCSA carrier check", "Pulled from FMCSA public records. Not an FMCSA rating.", "PUBLIC FMCSA"],
    ["Issues we found", "From the public-data check. Nothing here blocks the rest of setup.", "PUBLIC FMCSA"],
    ["Connect data", "Motive is the only confirmed integration. Other ELDs are coming soon.", ""],
    ["Confirm fleet", "Census power units. This preview does not import a truck list from Motive.", "PUBLIC FMCSA"],
    ["Invite your team", "Roles decide what each person would see. No email is sent.", "DEMO"],
    ["You're live", "What happens next. No agreement is signed and nothing is billed.", ""],
  ];
  const ROLES = [
    "Owner / admin",
    "Operations / dispatch",
    "Safety & compliance",
    "Maintenance",
    "Finance",
    "Insurance agent",
  ];

  const state = C.load(KEY, {
    step: 0,
    reached: 0,
    account: { name: "", email: "", phone: "", company: "", dot: "", mc: "" },
    phoneOk: false,
    profile: null,
    profileKey: "",
    profileError: "",
    loadingProfile: false,
    motiveDemo: false,
    uploads: { fuel: null, maintenance: null, insurance: null },
    trucks: null,
    trucksTouched: false,
    invites: [],
  });

  const $ = (id) => document.getElementById(id);

  function identKey() {
    return (state.account.dot || "").trim() + "|" + (state.account.mc || "").trim();
  }

  function lookupTarget() {
    const dot = (state.account.dot || "").trim();
    const mc = (state.account.mc || "").trim();
    if (/^\d+$/.test(dot)) return { url: "/carriers/" + dot, label: "USDOT " + dot };
    const raw = dot || mc;
    const num = raw.replace(/^(MC|MX|FF)[-\s#:]*/i, "");
    return { url: "/carriers/mc/" + encodeURIComponent(num), label: raw || "that number" };
  }

  function companyName() {
    return state.account.company
      || (state.profile && state.profile.identity && state.profile.identity.legal_name)
      || "your fleet";
  }

  function truckCount() {
    if (state.trucks !== null && state.trucks !== undefined && state.trucks !== "") return Number(state.trucks) || 0;
    const p = state.profile;
    return (p && p.fleet && p.fleet.power_units) || 0;
  }

  function paint() {
    const [title, sub, pill] = TITLES[state.step];
    $("kicker").textContent = "Step " + (state.step + 1) + " of " + TOTAL;
    $("prog").style.width = ((state.step + 1) / TOTAL * 100) + "%";
    $("title").textContent = state.step === 2 && state.profile
      ? "We found your carrier"
      : state.step === 3 && state.profile
        ? issueHeadline(state.profile.issues || [])
        : title;
    $("sub").textContent = sub;
    const pillEl = $("pill");
    if (pill) { pillEl.hidden = false; pillEl.textContent = pill; pillEl.className = "pill" + (pill.indexOf("FMCSA") >= 0 ? " real" : ""); }
    else pillEl.hidden = true;
    document.querySelectorAll("#steps button").forEach((btn) => {
      const n = Number(btn.dataset.step);
      btn.classList.toggle("on", n === state.step);
      btn.classList.toggle("done", n < state.step);
      btn.disabled = n > state.reached;
    });
    $("back").hidden = state.step === 0;
    const next = $("next");
    const alt = $("alt");
    alt.hidden = true;
    next.hidden = false;
    next.textContent = "Continue →";
    if (state.step === 2) {
      next.textContent = "Yes, this is us →";
      alt.hidden = false;
      alt.textContent = "Not my company";
    } else if (state.step === 7) {
      next.textContent = "Start over";
    }
  }

  function issueHeadline(issues) {
    const n = issues.length;
    if (n === 0) return "No issues stood out";
    if (n === 1) return "We found 1 issue";
    return "We found " + n + " issues";
  }

  function render() {
    C.save(KEY, state);
    paint();
    $("view").innerHTML = views[state.step]();
    if (state.step === 1) C.wireOtp($("view"));
    const needs = state.step === 2 || state.step === 3 || state.step === 5;
    if (needs && !state.profile && !state.profileError && !state.loadingProfile) ensureProfile();
  }

  async function ensureProfile() {
    if (state.loadingProfile) return;
    if (state.profile && state.profileKey === identKey()) return;
    state.loadingProfile = true;
    C.busy(true, "Loading public FMCSA records… The first lookup can take a little while.");
    const target = lookupTarget();
    try {
      const p = await C.api(target.url);
      state.profile = p;
      state.profileKey = identKey();
      state.profileError = "";
      if (!state.account.company && p.identity && p.identity.legal_name) state.account.company = p.identity.legal_name;
      if (!state.trucksTouched && p.fleet) state.trucks = p.fleet.power_units || 0;
    } catch (err) {
      state.profile = null;
      state.profileError = C.friendlyCarrier(err, target.label);
    } finally {
      state.loadingProfile = false;
      C.busy(false);
      render();
    }
  }

  function gate() {
    if (state.profileError && !state.profile) {
      return `<div class="card"><p class="err">${C.esc(state.profileError)}</p>
        <button type="button" class="primary" data-act="retry">Try again</button></div>`;
    }
    if (!state.profile) return `<div class="card muted">Loading public FMCSA records…</div>`;
    return "";
  }

  function accountView() {
    const a = state.account;
    return `<div class="card"><div class="grid-2">
      <label class="field"><span>Full name</span><input id="name" data-field="name" autocomplete="name" value="${C.esc(a.name)}"></label>
      <label class="field"><span>Work email</span><input id="email" data-field="email" type="email" autocomplete="email" value="${C.esc(a.email)}"></label>
      <label class="field"><span>Mobile phone</span><input id="phone" data-field="phone" type="tel" autocomplete="tel" placeholder="(555) 010-0142" value="${C.esc(a.phone)}"></label>
      <label class="field"><span>Company name</span><input id="company" data-field="company" autocomplete="organization" placeholder="Optional — filled from FMCSA if blank" value="${C.esc(a.company)}"></label>
      <label class="field"><span>USDOT number</span><input id="dot" data-field="dot" inputmode="numeric" placeholder="44110" value="${C.esc(a.dot)}"></label>
      <label class="field"><span>MC number (optional)</span><input id="mc" data-field="mc" placeholder="MC-1515" value="${C.esc(a.mc)}"></label>
    </div>
    <p class="err" id="formerr" hidden></p>
    <p class="muted">We use the number only to read public FMCSA records. No account is created.</p></div>`;
  }

  function phoneView() {
    return `<div class="card">${C.phoneHtml()}</div><p class="err" id="formerr" hidden></p>`;
  }

  function carrierView() {
    const blocked = gate();
    if (blocked) return blocked;
    const p = state.profile;
    const id = p.identity || {};
    const addr = id.physical_address || {};
    const place = [addr.city, addr.state].filter(Boolean).join(", ");
    const docks = (id.dockets || []).map((d) => d.docket).filter(Boolean).join(" · ");
    const insp = p.inspections_24mo || { vehicle: {}, driver: {}, total: 0 };
    const fh = p.fleet_health || { score: 0, factors: [], version: "", disclaimer: "" };
    const chips = [
      `<span class="chip">USDOT ${C.esc(id.usdot_status || "—")}</span>`,
      `<span class="chip ${p.authority && p.authority.any_active ? "" : "warn"}">Authority ${p.authority && p.authority.any_active ? "active" : "not active"}</span>`,
      `<span class="chip ${p.boc3 && p.boc3.on_file ? "" : "warn"}">BOC-3 ${p.boc3 && p.boc3.on_file ? "on file" : "not on file"}</span>`,
      `<span class="chip ${(p.insurance && p.insurance.active_or_pending || []).length ? "" : "warn"}">${(p.insurance && p.insurance.active_or_pending || []).length ? "Insurance filing on file" : "No insurance filing"}</span>`,
    ].join("");
    const factors = (fh.factors || []).map((f) => {
      const pct = f.max ? Math.max(0, Math.min(100, 100 * f.points / f.max)) : 0;
      return `<div class="factor" title="${C.esc(f.detail)}"><div class="nm">${C.esc(C.FACTORS[f.factor] || f.factor)}</div>
        <div class="pts">${C.esc(f.points)} / ${C.esc(f.max)}</div>
        <div class="track"><i style="width:${pct}%;background:${C.scoreColor(fh.score)}"></i></div></div>`;
    }).join("");
    const soonest = (p.insurance && p.insurance.active_or_pending || [])
      .map((x) => x.estimated_renewal)
      .filter(Boolean)
      .sort((a, b) => a.days_until - b.days_until)[0];
    const renew = soonest
      ? `<p class="muted" style="margin:8px 0 0">Soonest filing anniversary: ${C.esc(soonest.date)} (${C.esc(soonest.days_until)} days) <span class="est">ESTIMATE</span></p>`
      : "";
    return `<div class="card">
      <div>
        <p class="who name">${C.esc(id.legal_name || "Carrier")}</p>
        <p class="muted" style="margin:2px 0 0">${id.dba_name ? "DBA " + C.esc(id.dba_name) + " · " : ""}USDOT ${C.esc(p.dot_number)}${docks ? " · " + C.esc(docks) : ""}${place ? " · " + C.esc(place) : ""}</p>
        <div class="chips">${chips}</div>
        ${renew}
      </div>
      <div class="carrier-grid" style="margin-top:14px">
        <div>${C.ring(fh.score)}<div class="score-cap">Fleet Health Score<br><span class="muted">${C.esc(fh.version)}</span></div></div>
        <div>
          <div class="oos-pair">
            ${oosRow("Vehicle OOS", insp.vehicle)}
            ${oosRow("Driver OOS", insp.driver)}
          </div>
          <p class="muted" style="margin:8px 0 0">Lower is better. Bars compare this carrier with the national average only — not a peer group.</p>
        </div>
        <div class="means">${meanings(p)}</div>
      </div>
      <div class="factors">${factors}</div>
      <p class="muted" style="margin:10px 0 0">${C.esc(insp.total)} inspections · ${C.esc(p.crashes_24mo && p.crashes_24mo.total)} crashes in 24 months. ${C.esc(fh.disclaimer || "")}</p>
    </div>`;
  }

  function oosRow(label, block) {
    block = block || {};
    if (block.oos_rate === null || block.oos_rate === undefined) {
      return `<div class="oos"><div class="oos-h"><span>${C.esc(label)}</span><b>—</b></div><p class="muted">Not enough inspections to rate.</p></div>`;
    }
    const nat = Number(block.national_avg) || 0;
    const rate = Number(block.oos_rate) || 0;
    const max = Math.max(rate, nat, 1) * 1.2;
    const w = (v) => Math.max(2, Math.min(100, v / max * 100));
    const col = rate <= nat ? "#22604b" : "#c2410c";
    return `<div class="oos">
      <div class="oos-h"><span>${C.esc(label)}</span><b>${rate}%</b></div>
      <div class="track"><i style="width:${w(rate)}%;background:${col}"></i></div>
      <div class="oos-h nat"><span>National avg</span><span>${nat}%</span></div>
      <div class="track thin"><i style="width:${w(nat)}%;background:#c5d0dc"></i></div>
    </div>`;
  }

  function meanings(p) {
    const bits = [];
    const v = (p.inspections_24mo && p.inspections_24mo.vehicle) || {};
    const d = (p.inspections_24mo && p.inspections_24mo.driver) || {};
    if (v.oos_rate != null && v.inspections >= 3) {
      const better = v.oos_rate <= v.national_avg;
      bits.push(`<div>${mark(better)}<span>Vehicle out-of-service rate is ${better ? "at or below" : "above"} the national average (${v.oos_rate}% vs ${v.national_avg}%).</span></div>`);
    }
    if (d.oos_rate != null && d.inspections >= 3) {
      const better = d.oos_rate <= d.national_avg;
      bits.push(`<div>${mark(better)}<span>Driver out-of-service rate is ${better ? "at or below" : "above"} the national average (${d.oos_rate}% vs ${d.national_avg}%).</span></div>`);
    }
    const filing = p.insurance && (p.insurance.active_or_pending || []).length > 0;
    const auth = p.authority && p.authority.any_active;
    const boc = p.boc3 && p.boc3.on_file;
    bits.push(`<div>${mark(auth && filing && boc)}<span>${auth ? "Operating authority is active." : "No active operating authority on file."} ${filing ? "An insurance filing is on file." : "No active insurance filing."} ${boc ? "BOC-3 is on file." : "No BOC-3 on file."}</span></div>`);
    const est = (p.issues || []).some((i) => i.estimated);
    if (est) bits.push(`<div>${mark(false)}<span>A renewal date below is an estimate. FMCSA filings do not publish an expiration date.</span></div>`);
    return bits.join("");
  }

  function mark(ok) {
    return `<span class="mark ${ok ? "ok" : "warn"}">${ok ? "✓" : "!"}</span>`;
  }

  function issuesView() {
    const blocked = gate();
    if (blocked) return blocked;
    const issues = state.profile.issues || [];
    if (!issues.length) {
      return `<div class="card"><p>Nothing in the public-data rules fired for this carrier.</p><p class="muted">That is not a clean bill of health. It means these particular checks — authority, BOC-3, insurance filing, MCS-150 age, out-of-service rate, revocations — did not flag.</p></div>`;
    }
    return issues.map((i) => `<article class="card issue">
      <div class="issue-top"><span class="sev ${C.esc(i.severity)}">${C.esc(i.severity)}</span><h3>${C.esc(i.title)}</h3>${i.estimated ? '<span class="est">ESTIMATE</span>' : ""}</div>
      <p>${C.esc(i.detail)}</p>
    </article>`).join("") + `<p class="muted">These are rules over public FMCSA data. Kickoff is where you decide what to do with them. No workflow is started from this screen.</p>`;
  }

  function fileNote(slot) {
    const f = state.uploads[slot];
    if (!f) return `<p class="muted">No file chosen. Only the name would be kept in this browser — the file is not uploaded.</p>`;
    return `<p class="fileline">${C.esc(f.name)}</p><p class="muted">Name only, in this browser. The file was not uploaded.</p>`;
  }

  function connectView() {
    const motive = state.motiveDemo
      ? `<span class="chip demo">Demo — not connected</span>`
      : `<span class="chip warn">Not connected</span>`;
    return `<div class="src-grid">
      <article class="card src wide">
        <div class="src-h"><h3>Motive ELD</h3>${motive}</div>
        <p>Confirmed integration. Sign-in would be a Motive admin approving read-only access (trucks, drivers, HOS, location, vehicle data). We would not change anything in Motive. This preview has no Motive OAuth app, so Connect does not sign you in.</p>
        <button type="button" class="primary" data-act="motive">${state.motiveDemo ? "Clear demo mark" : "Connect"}</button>
        ${state.motiveDemo ? `<p class="banner demo" style="margin-top:10px">Demo only. You are not signed in to Motive. No data was read.</p>` : ""}
        <p class="muted">An API key is the other path a Motive admin might use later. Don't paste a real key here — this preview does not store or send keys.</p>
      </article>
      ${uploadCard("fuel", "Fuel card", "Upload a transaction export (CSV, XLSX, or PDF). A direct fuel-card connection is not available in this preview.")}
      ${uploadCard("maintenance", "Maintenance & repairs", "Repair invoices, a PM schedule, or a shop export. Upload only — no shop system is connected.")}
      ${uploadCard("insurance", "Insurance documents", "Policy, dec page, or loss runs. Useful before kickoff, and needed if a renewal is inside 90 days.")}
      <article class="card src">
        <div class="src-h"><h3>Other ELDs</h3><span class="soon-tag">Coming soon</span></div>
        <p>Samsara, Geotab, Omnitracs, and BigRoad are not integrations. We won't imply a login we don't have.</p>
      </article>
      <article class="card src">
        <div class="src-h"><h3>Dispatch chat</h3><span class="soon-tag">Coming soon</span></div>
        <p>Telegram or WhatsApp is optional. How it would connect is not confirmed, so it stays off.</p>
      </article>
    </div>
    <p class="muted">No Motive yet? You can still continue. Upload what you have, or skip and pick it up at kickoff. CoRun Cargo and Green Miles are coming soon — they are not part of this setup.</p>`;
  }

  function uploadCard(slot, title, copy) {
    return `<article class="card src"><h3>${title}</h3><p>${copy}</p>
      <input type="file" data-file="${slot}" accept=".csv,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,image/*,application/pdf">
      ${fileNote(slot)}</article>`;
  }

  function fleetView() {
    const blocked = gate();
    if (blocked) return blocked;
    const f = state.profile.fleet || {};
    const cargo = (f.cargo_carried || []).join(", ") || "—";
    const n = truckCount();
    return `<div class="stats">
      <div class="stat"><span class="k">Power units</span><b>${C.esc(f.power_units)}</b></div>
      <div class="stat"><span class="k">Truck units</span><b>${C.esc(f.truck_units)}</b></div>
      <div class="stat"><span class="k">Bus units</span><b>${C.esc(f.bus_units)}</b></div>
      <div class="stat"><span class="k">Drivers</span><b>${C.esc(f.total_drivers)}</b></div>
    </div>
    <div class="card">
      <p class="muted" style="margin-top:0">Cargo on the census: ${C.esc(cargo)}. ${state.motiveDemo
        ? "The Motive button was a demo mark, so no trucks were imported."
        : "Motive isn't connected, so there is no imported unit list. Confirm the count yourself."}</p>
      <label class="field"><span>Active trucks for membership</span>
        <input id="trucks" type="number" min="0" step="1" value="${C.esc(n)}"></label>
      <p class="muted">Defaults to FMCSA power units. Change it if that count isn't the fleet you'd enroll. Monthly total on the last step is this number × $50. Nothing is billed.</p>
    </div>`;
  }

  function inviteView() {
    const opts = ROLES.map((r) => `<option>${C.esc(r)}</option>`).join("");
    const rows = state.invites.length
      ? `<table><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr>${state.invites.map((inv, i) =>
          `<tr><td>${C.esc(inv.name)}</td><td>${C.esc(inv.email)}</td><td>${C.esc(inv.role)}</td><td><button type="button" class="textbtn" data-act="drop-invite" data-i="${i}">Remove</button></td></tr>`
        ).join("")}</table>`
      : `<p class="muted">No one added yet. You can skip this and invite people later.</p>`;
    const agent = state.invites.some((i) => i.role === "Insurance agent");
    return `<div class="banner demo">No email is sent. People you add stay in this browser until you clear it.</div>
      <div class="card">
        <div class="invite-row">
          <label class="field"><span>Name</span><input id="inv-name" placeholder="Alex Rivera"></label>
          <label class="field"><span>Work email</span><input id="inv-email" type="email" placeholder="alex@example.com"></label>
          <label class="field"><span>Role</span><select id="inv-role">${opts}</select></label>
          <button type="button" class="primary" data-act="add-invite">Add</button>
        </div>
        <p class="err" id="formerr" hidden></p>
        ${rows}
        ${agent ? `<p class="muted">An insurance agent would only see what you later share to an agency workspace. That workspace is not created here.</p>` : ""}
      </div>`;
  }

  function liveView() {
    const n = truckCount();
    const monthly = n * 50;
    const name = companyName();
    return `<div class="split">
      <div class="card">
        <h2 style="margin:0 0 8px;font-size:18px">What happens next</h2>
        <div class="timeline">
          <div class="tl"><b>Kickoff</b><span>Day 2–4, 30 minutes. What's connected, what's still missing, your top headaches, and the insurance renewal date.</span></div>
          <div class="tl"><b>Day 7</b><span>A first look at areas where there is enough of your own data. Gaps are named. We don't fill them with guesses.</span></div>
          <div class="tl"><b>Day 14</b><span>First review. Findings from your records, each turned into a task with an owner. You pick the Weekly Brief day.</span></div>
          <div class="tl"><b>Weekly Brief</b><span>After that review: what changed, what's off track, what needs a decision. About five minutes to read.</span></div>
        </div>
      </div>
      <div class="card price">
        <span class="k">Membership</span>
        <div class="big">${C.money(monthly)}<span style="font-size:16px;font-weight:600">/mo</span></div>
        <p style="margin:0">${n.toLocaleString("en-US")} × $50 per truck / month</p>
        <p class="muted">${C.esc(name)}. This uses the count from the fleet step. It is not a bill, and no card is charged.</p>
      </div>
    </div>
    <p class="muted">Software roles for fuel, maintenance, and safety review data once it's actually connected. CoRun Cargo and Green Miles are coming soon and are not part of onboarding. Setup for ${C.esc(name)} is stored only in this browser.</p>`;
  }

  const views = [accountView, phoneView, carrierView, issuesView, connectView, fleetView, inviteView, liveView];

  function showErr(msg) {
    const el = $("formerr");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
  }

  function validate() {
    if (state.step === 0) {
      const a = state.account;
      if (!a.name.trim() || !a.email.trim() || !a.phone.trim()) {
        showErr("Name, work email, and phone are required.");
        return false;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim())) {
        showErr("Enter a work email like alex@company.com.");
        return false;
      }
      if ((a.phone.match(/\d/g) || []).length < 7) {
        showErr("Enter a phone number with at least 7 digits.");
        return false;
      }
      if (!a.dot.trim() && !a.mc.trim()) {
        showErr("Enter a USDOT or an MC number. USDOT 44110 is a real carrier you can try.");
        return false;
      }
    }
    if (state.step === 1 && C.otpValue().length !== 6) {
      showErr("Enter any 6 digits. No code was sent.");
      return false;
    }
    if ((state.step === 2 || state.step === 3 || state.step === 5) && !state.profile) {
      showErr("We still need a carrier from FMCSA before continuing.");
      return false;
    }
    showErr("");
    return true;
  }

  function go(n) {
    state.step = n;
    state.reached = Math.max(state.reached, n);
    render();
  }

  async function onNext() {
    if (state.step === 7) {
      localStorage.removeItem(KEY);
      location.reload();
      return;
    }
    if (!validate()) return;
    if (state.step === 1) state.phoneOk = true;
    if (state.step === 5) {
      const input = $("trucks");
      if (input) {
        state.trucks = Math.max(0, parseInt(input.value, 10) || 0);
        state.trucksTouched = true;
      }
    }
    go(state.step + 1);
  }

  $("next").onclick = onNext;
  $("back").onclick = () => { if (state.step > 0) go(state.step - 1); };
  $("alt").onclick = () => { if (state.step === 2) go(0); };
  $("steps").onclick = (e) => {
    const btn = e.target.closest("button");
    if (!btn || btn.disabled) return;
    go(Number(btn.dataset.step));
  };

  $("view").addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.field && state.account) {
      state.account[t.dataset.field] = t.value;
      if (t.dataset.field === "phone") state.phoneOk = false;
      if (t.dataset.field === "dot" || t.dataset.field === "mc") {
        state.profile = null;
        state.profileKey = "";
        state.profileError = "";
      }
      C.save(KEY, state);
    }
    if (t.id === "trucks") {
      state.trucks = Math.max(0, parseInt(t.value, 10) || 0);
      state.trucksTouched = true;
      C.save(KEY, state);
    }
  });

  $("view").addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.file && t.files && t.files[0]) {
      state.uploads[t.dataset.file] = { name: t.files[0].name, size: t.files[0].size };
      C.save(KEY, state);
      render();
    }
  });

  $("view").addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    if (!t) return;
    if (t.dataset.act === "retry") {
      state.profileError = "";
      ensureProfile();
    }
    if (t.dataset.act === "motive") {
      state.motiveDemo = !state.motiveDemo;
      render();
    }
    if (t.dataset.act === "add-invite") {
      const name = $("inv-name").value.trim();
      const email = $("inv-email").value.trim();
      const role = $("inv-role").value;
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showErr("Add a name and a real-looking email. It stays in this browser.");
        return;
      }
      state.invites.push({ name, email, role });
      render();
    }
    if (t.dataset.act === "drop-invite") {
      state.invites.splice(Number(t.dataset.i), 1);
      render();
    }
  });

  $("view").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "file") {
      e.preventDefault();
      onNext();
    }
  });

  render();
})();
