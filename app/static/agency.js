/* Agency onboarding. Book, risk, renewals, and insurer search call the live API. */
(function () {
  const C = window.CoRun;
  const KEY = "corun.agency.onboarding.v1";
  const TOTAL = 8;
  const TITLES = [
    ["Agency account", "Your name and the agency. Carriers are added on the next screens.", ""],
    ["Verify phone", "Demo only — prove the screen, not the phone.", "DEMO"],
    ["Add your book", "One USDOT or MC per line. We match them to the FMCSA census.", "PUBLIC FMCSA"],
    ["Book risk dashboard", "Live risk picture from public FMCSA data for the carriers that matched.", "PUBLIC FMCSA"],
    ["Renewal radar", "Filing anniversaries inside 90 days. FMCSA does not publish expiration dates.", "ESTIMATED"],
    ["Prospect finder", "Carriers with an active or pending filing from an insurer you name.", "PUBLIC FMCSA"],
    ["Invite carriers", "Saved here only. No email is sent.", "DEMO"],
    ["You're live", "What you can do with this book. Nothing is emailed.", ""],
  ];

  const state = C.load(KEY, {
    step: 0,
    reached: 0,
    account: { name: "", email: "", phone: "", agency: "" },
    bookText: "",
    book: null,
    bookError: "",
    renewals: null,
    renewalsError: "",
    loading: false,
    query: "",
    search: null,
    searchError: "",
    notes: [],
    invites: [],
  });

  const $ = (id) => document.getElementById(id);

  function idsFromText() {
    return state.bookText.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  }

  function paint() {
    const [title, sub, pill] = TITLES[state.step];
    $("kicker").textContent = "Step " + (state.step + 1) + " of " + TOTAL;
    $("prog").style.width = ((state.step + 1) / TOTAL * 100) + "%";
    $("title").textContent = title;
    $("sub").textContent = sub;
    const pillEl = $("pill");
    if (pill) {
      pillEl.hidden = false;
      pillEl.textContent = pill;
      pillEl.className = "pill" + (pill === "PUBLIC FMCSA" ? " real" : "");
    } else pillEl.hidden = true;
    document.querySelectorAll("#steps button").forEach((btn) => {
      const n = Number(btn.dataset.step);
      btn.classList.toggle("on", n === state.step);
      btn.classList.toggle("done", n < state.step);
      btn.disabled = n > state.reached;
    });
    $("back").hidden = state.step === 0;
    const next = $("next");
    next.hidden = false;
    next.textContent = "Continue →";
    if (state.step === 2) next.textContent = "Look up book →";
    if (state.step === 3) next.textContent = "See renewals →";
    if (state.step === 7) next.textContent = "Start over";
  }

  function render() {
    C.save(KEY, state);
    paint();
    $("view").innerHTML = views[state.step]();
    if (state.step === 1) C.wireOtp($("view"));
    if (state.step === 4 && state.book && !state.renewals && !state.renewalsError && !state.loading) loadRenewals();
  }

  function accountView() {
    const a = state.account;
    return `<div class="card"><div class="grid-2">
      <label class="field"><span>Your name</span><input data-field="name" autocomplete="name" value="${C.esc(a.name)}"></label>
      <label class="field"><span>Work email</span><input data-field="email" type="email" autocomplete="email" value="${C.esc(a.email)}"></label>
      <label class="field"><span>Mobile phone</span><input data-field="phone" type="tel" autocomplete="tel" value="${C.esc(a.phone)}"></label>
      <label class="field"><span>Agency name</span><input data-field="agency" autocomplete="organization" value="${C.esc(a.agency)}"></label>
    </div>
    <p class="err" id="formerr" hidden></p>
    <p class="muted">No agency login is created. This preview keeps what you type in the browser.</p></div>`;
  }

  function phoneView() {
    return `<div class="card">${C.phoneHtml()}</div><p class="err" id="formerr" hidden></p>`;
  }

  function bookView() {
    const summary = state.book ? bookSummary(state.book) : "";
    return `<div class="card">
      <label class="field"><span>DOT or MC numbers</span>
        <textarea id="booktext" placeholder="44110&#10;MC-1515">${C.esc(state.bookText)}</textarea></label>
      <p class="err" id="formerr"${state.bookError ? "" : " hidden"}>${C.esc(state.bookError)}</p>
      <p class="muted">Try USDOT 44110. Unmatched lines are listed and left out of the rollup. Duplicates of the same DOT are flagged.</p>
      ${summary}
    </div>`;
  }

  function bookSummary(book) {
    const r = book.rollup;
    const bad = (book.unmatched || []).length
      ? `<p class="muted">Not matched: ${book.unmatched.map(C.esc).join(", ")}</p>` : "";
    const dups = (book.duplicates || []).length
      ? `<p class="muted">${book.duplicates.length} duplicate line${book.duplicates.length === 1 ? "" : "s"} ignored.</p>` : "";
    return `<p><b>${r.matched}</b> of ${r.carriers_submitted} matched · ${r.total_power_units} power units · avg Fleet Health ${r.avg_fleet_health ?? "—"}</p>${bad}${dups}`;
  }

  function dashView() {
    if (!state.book || !state.book.rollup.matched) {
      return `<div class="card"><p>Add at least one DOT or MC that matches the census.</p></div>`;
    }
    const r = state.book.rollup;
    const dist = r.health_distribution || {};
    const order = ["<50", "50-69", "70-84", "85+"];
    const max = Math.max(1, ...order.map((k) => dist[k] || 0));
    const bars = order.map((k) => {
      const n = dist[k] || 0;
      const h = Math.round(100 * n / max);
      return `<div class="col"><b>${n}</b><div class="shaft"><i style="height:${n ? Math.max(h, 8) : 0}%"></i></div><span>${C.esc(k)}</span></div>`;
    }).join("");
    const rows = state.book.carriers_by_risk.slice(0, 8).map((m) => {
      const top = (m.issues || [])[0];
      return `<tr>
        <td>${C.esc(m.legal_name)}</td>
        <td>${C.esc(m.dot_number)}</td>
        <td>${C.esc(m.power_units)}</td>
        <td class="score-n" style="color:${C.scoreColor(m.fleet_health)}">${C.esc(m.fleet_health)}</td>
        <td>${top ? `<span class="sev ${C.esc(top.severity)}">${C.esc(top.severity)}</span> ${C.esc(top.title)}` : "—"}</td>
      </tr>`;
    }).join("");
    let oos = `<p class="muted">No vehicle out-of-service rate on the matched carriers.</p>`;
    if (r.vehicle_oos_avg != null) {
      const nat = r.vehicle_oos_national;
      const better = r.vehicle_oos_avg <= nat;
      oos = `<p style="margin:8px 0 0">Vehicle OOS, average of ${r.vehicle_oos_n} carrier${r.vehicle_oos_n === 1 ? "" : "s"} with a rate: <b>${r.vehicle_oos_avg}%</b>. National average ${nat}% (as of ${C.esc(r.national_oos_as_of)}). This book is ${better ? "at or below" : "above"} that average.</p>`;
    }
    return `<div class="stats">
      <div class="stat"><span class="k">Carriers</span><b>${r.matched}<em> / ${r.carriers_submitted}</em></b></div>
      <div class="stat"><span class="k">Power units</span><b>${r.total_power_units}</b></div>
      <div class="stat"><span class="k">Avg Fleet Health</span><b>${r.avg_fleet_health ?? "—"}<em> /100</em></b></div>
      <div class="stat"><span class="k">High-severity issues</span><b>${r.carriers_with_high_issues}</b></div>
    </div>
    <div class="split">
      <div class="card"><span class="k">Fleet Health distribution</span><div class="dist" style="margin-top:10px">${bars}</div>${oos}</div>
      <div class="card"><span class="k">Highest risk first</span>
        <table><tr><th>Carrier</th><th>DOT</th><th>Units</th><th>Score</th><th>Top issue</th></tr>${rows}</table>
      </div>
    </div>
    <p class="muted">Scores are the v0 draft composite from public data. Not an FMCSA rating and not underwriting advice. "High-severity" counts carriers with at least one high issue from the public-data rules — not a CSA alert count.</p>`;
  }

  function renewalView() {
    if (state.renewalsError) {
      return `<div class="card"><p class="err">${C.esc(state.renewalsError)}</p><button type="button" class="primary" data-act="retry-renewals">Try again</button></div>`;
    }
    if (!state.renewals) return `<div class="card muted">Estimating renewal dates…</div>`;
    const b = state.renewals.buckets || {};
    const cards = [["0-30", "Next 30 days"], ["31-60", "31–60 days"], ["61-90", "61–90 days"]].map(([k, label]) =>
      `<div class="stat"><span class="k">${label}</span><b>${b[k] || 0}</b></div>`
    ).join("");
    const rows = (state.renewals.renewals || []).map((x) => `<tr>
      <td>${C.esc(x.legal_name)}<div class="muted">USDOT ${C.esc(x.dot_number)}</div></td>
      <td>${C.esc(x.insurer)}<div class="muted">${C.esc(x.form)} · ${C.esc(x.policy_no)}</div></td>
      <td>${x.max_coverage ? C.money(x.max_coverage) : "—"}</td>
      <td>${C.esc(x.estimated_renewal)} <span class="est">ESTIMATE</span></td>
      <td>${C.esc(x.days_until)}</td>
    </tr>`).join("");
    return `<div class="banner demo"><b>Estimated.</b> ${C.esc(state.renewals.method || "Next anniversary of the FMCSA effective date.")}</div>
      <div class="stats">${cards}</div>
      <div class="card">${rows ? `<table><tr><th>Carrier</th><th>Filing</th><th>Coverage</th><th>Est. renewal</th><th>Days</th></tr>${rows}</table>`
        : `<p>No estimated renewal falls inside 90 days for this book.</p>`}
      <p class="muted">Each row is a filing anniversary, not a policy expiration the insurer sent us. Coverage is the FMCSA max on file, when present.</p></div>`;
  }

  function prospectView() {
    let table = "";
    if (state.searchError) table = `<p class="err">${C.esc(state.searchError)}</p>`;
    else if (state.search) {
      const rows = (state.search.carriers || []).map((c, i) => {
        const f = (c.filings || [])[0] || {};
        return `<tr>
          <td>${C.esc(c.dot_number)}</td>
          <td>${C.esc(c.docket)}</td>
          <td>${C.esc(f.insurer)}</td>
          <td>${C.esc(f.form)}</td>
          <td>${C.esc(f.effective_date)}</td>
          <td><button type="button" class="ghost" data-act="note" data-i="${i}">Note</button></td>
        </tr>`;
      }).join("");
      table = `<p class="muted">${state.search.count} carriers · ${C.esc(state.search.source || "FMCSA Motus Insur")}</p>
        <table><tr><th>DOT</th><th>Docket</th><th>Insurer</th><th>Form</th><th>Effective</th><th></th></tr>${rows || ""}</table>`;
    }
    const noted = state.notes.length
      ? `<p class="muted">Noted in this browser: ${state.notes.map((n) => C.esc(n.dot)).join(", ")}</p>` : "";
    return `<div class="card">
      <div class="invite-row" style="grid-template-columns:1fr auto">
        <label class="field"><span>Insurer name</span><input id="q" value="${C.esc(state.query)}" placeholder="At least 3 letters"></label>
        <button type="button" class="primary" data-act="search">Search</button>
      </div>
      <p class="err" id="formerr" hidden></p>
      ${table}
      ${noted}
    </div>`;
  }

  function inviteView() {
    const carriers = (state.book && state.book.carriers_by_risk) || [];
    const opts = carriers.map((c) => `<option value="${C.esc(c.dot_number)}">${C.esc(c.legal_name)} · ${C.esc(c.dot_number)}</option>`).join("");
    const rows = state.invites.length
      ? `<table><tr><th>Carrier</th><th>Email</th><th></th></tr>${state.invites.map((inv, i) =>
          `<tr><td>${C.esc(inv.label)}</td><td>${C.esc(inv.email)}</td><td><button type="button" class="textbtn" data-act="drop" data-i="${i}">Remove</button></td></tr>`
        ).join("")}</table>`
      : `<p class="muted">No invites yet.</p>`;
    return `<div class="banner demo">No email is sent. A real invite would come later, and the carrier would choose what an agency can see.</div>
      <div class="card">
        <div class="invite-row" style="grid-template-columns:1.2fr 1fr auto">
          <label class="field"><span>Carrier from this book</span><select id="who">${opts || `<option value="">Add a book first</option>`}</select></label>
          <label class="field"><span>Email</span><input id="inv-email" type="email" placeholder="ops@carrier.com"></label>
          <button type="button" class="primary" data-act="add">Add</button>
        </div>
        <p class="err" id="formerr" hidden></p>
        ${rows}
      </div>`;
  }

  function liveView() {
    const r = state.book && state.book.rollup;
    const agency = state.account.agency || "your agency";
    const stats = r ? `<div class="stats">
      <div class="stat"><span class="k">Matched carriers</span><b>${r.matched}</b></div>
      <div class="stat"><span class="k">Power units</span><b>${r.total_power_units}</b></div>
      <div class="stat"><span class="k">Avg Fleet Health</span><b>${r.avg_fleet_health ?? "—"}</b></div>
      <div class="stat"><span class="k">Noted prospects</span><b>${state.notes.length}</b></div>
    </div>` : `<div class="card">No book was matched, so there are no live figures to show.</div>`;
    return `${stats}
      <div class="card">
        <h2 style="margin:0 0 8px;font-size:18px">What you have</h2>
        <div class="timeline">
          <div class="tl"><b>Book</b><span>The risk list is the public FMCSA picture for the DOTs that matched. It is not a CSA score and not a quote.</span></div>
          <div class="tl"><b>Renewals</b><span>Dates inside 90 days are filing anniversaries, marked estimate. They are not expiration dates from the insurer.</span></div>
          <div class="tl"><b>Prospects</b><span>Insurer search reads active and pending FMCSA filings. Notes stay in this browser.</span></div>
          <div class="tl"><b>Invites</b><span>${state.invites.length} saved for ${C.esc(agency)}. No email went out.</span></div>
        </div>
      </div>
      <p class="muted">FMCSA publishes these datasets daily. A lookup uses the public files and may be cached for up to 24 hours. CoRun Cargo and Green Miles are coming soon and are not part of this setup.</p>`;
  }

  const views = [accountView, phoneView, bookView, dashView, renewalView, prospectView, inviteView, liveView];

  function showErr(msg) {
    const el = $("formerr");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
  }

  function validate() {
    if (state.step === 0) {
      const a = state.account;
      if (!a.name.trim() || !a.agency.trim() || !a.email.trim() || !a.phone.trim()) {
        showErr("Name, agency, work email, and phone are required.");
        return false;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim())) {
        showErr("Enter a work email.");
        return false;
      }
      if ((a.phone.match(/\d/g) || []).length < 7) {
        showErr("Enter a phone number with at least 7 digits.");
        return false;
      }
    }
    if (state.step === 1 && C.otpValue().length !== 6) {
      showErr("Enter any 6 digits. No code was sent.");
      return false;
    }
    if (state.step === 2 && !idsFromText().length) {
      showErr("Paste at least one USDOT or MC. 44110 is a real one.");
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

  async function lookupBook(advance) {
    const identifiers = idsFromText();
    state.loading = true;
    C.busy(true, "Looking up public FMCSA records…");
    try {
      const book = await C.api("/agency/book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifiers, renewal_window_days: 90 }),
      });
      state.book = book;
      state.renewals = null;
      state.renewalsError = "";
      state.bookError = "";
      if (advance) {
        if (book.rollup.matched > 0) go(3);
        else state.bookError = "None of those numbers matched an FMCSA census record.";
      }
    } catch (err) {
      state.bookError = err.message || "The book lookup didn't finish.";
    } finally {
      state.loading = false;
      C.busy(false);
      render();
    }
  }

  async function loadRenewals() {
    if (!state.book || state.loading) return;
    const identifiers = state.book.carriers_by_risk.map((c) => c.dot_number);
    state.loading = true;
    C.busy(true, "Estimating renewal dates from FMCSA filings…");
    try {
      state.renewals = await C.api("/agency/renewals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifiers, renewal_window_days: 90 }),
      });
      state.renewalsError = "";
    } catch (err) {
      state.renewalsError = err.message || "Renewal lookup didn't finish.";
    } finally {
      state.loading = false;
      C.busy(false);
      render();
    }
  }

  async function searchInsurers() {
    const name = ($("q") && $("q").value || state.query).trim();
    state.query = name;
    if (name.length < 3) {
      showErr("Enter at least 3 letters of an insurer name.");
      return;
    }
    state.loading = true;
    C.busy(true, "Searching FMCSA insurance filings…");
    try {
      state.search = await C.api("/insurers/search?name=" + encodeURIComponent(name) + "&limit=12");
      state.searchError = "";
    } catch (err) {
      state.search = null;
      state.searchError = err.message || "Search didn't finish.";
    } finally {
      state.loading = false;
      C.busy(false);
      render();
    }
  }

  async function onNext() {
    if (state.step === 7) {
      localStorage.removeItem(KEY);
      location.reload();
      return;
    }
    if (!validate()) return;
    if (state.step === 2) {
      await lookupBook(true);
      return;
    }
    go(state.step + 1);
  }

  $("next").onclick = onNext;
  $("back").onclick = () => { if (state.step > 0) go(state.step - 1); };
  $("steps").onclick = (e) => {
    const btn = e.target.closest("button");
    if (!btn || btn.disabled) return;
    go(Number(btn.dataset.step));
  };

  $("view").addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.field) {
      state.account[t.dataset.field] = t.value;
      C.save(KEY, state);
    }
    if (t.id === "booktext") {
      state.bookText = t.value;
      C.save(KEY, state);
    }
    if (t.id === "q") state.query = t.value;
  });

  $("view").addEventListener("click", async (e) => {
    const t = e.target.closest("[data-act]");
    if (!t) return;
    if (t.dataset.act === "retry-renewals") {
      state.renewalsError = "";
      state.renewals = null;
      loadRenewals();
    }
    if (t.dataset.act === "search") searchInsurers();
    if (t.dataset.act === "note" && state.search) {
      const c = state.search.carriers[Number(t.dataset.i)];
      if (!c) return;
      const f = (c.filings || [])[0] || {};
      if (!state.notes.some((n) => n.dot === c.dot_number)) {
        state.notes.push({ dot: c.dot_number, insurer: f.insurer || "" });
      }
      render();
    }
    if (t.dataset.act === "add") {
      const sel = $("who");
      const email = $("inv-email").value.trim();
      if (!sel || !sel.value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showErr("Pick a carrier and enter an email. Nothing is sent.");
        return;
      }
      state.invites.push({ dot: sel.value, label: sel.options[sel.selectedIndex].text, email });
      render();
    }
    if (t.dataset.act === "drop") {
      state.invites.splice(Number(t.dataset.i), 1);
      render();
    }
  });

  $("view").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName === "INPUT") {
      e.preventDefault();
      if (state.step === 5) searchInsurers();
      else onNext();
    }
  });

  render();
})();
