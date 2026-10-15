/* Shared helpers for the onboarding pages. No network side effects. */
(function () {
  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function dash(s) {
    const t = esc(s);
    return t ? t : "—";
  }

  function money(n) {
    const v = Math.round(Number(n) || 0);
    return "$" + v.toLocaleString("en-US");
  }

  function scoreColor(s) {
    if (s >= 85) return "#22604b";
    if (s >= 70) return "#315c4d";
    if (s >= 50) return "#c2410c";
    return "#b42318";
  }

  const FACTORS = {
    vehicle_oos: "Vehicle OOS",
    driver_oos: "Driver OOS",
    crashes: "Crashes",
    compliance: "Compliance",
    standing: "Standing",
  };

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return Object.assign(fallback, JSON.parse(raw));
    } catch (e) {
      return fallback;
    }
  }

  function save(key, state) {
    localStorage.setItem(key, JSON.stringify(state));
  }

  async function api(url, opts) {
    const r = await fetch(url, opts);
    let body = null;
    try { body = await r.json(); } catch (e) { body = null; }
    if (!r.ok) {
      let detail = "Request failed (" + r.status + ")";
      if (body && typeof body.detail === "string") detail = body.detail;
      const err = new Error(detail);
      err.status = r.status;
      throw err;
    }
    return body;
  }

  function ring(score) {
    const r = 46;
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(100, Number(score) || 0)) / 100;
    const col = scoreColor(score);
    return `<div class="ring" aria-label="Fleet Health Score ${esc(score)} out of 100">
      <svg viewBox="0 0 120 120" width="118" height="118" aria-hidden="true">
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="#e6eeea" stroke-width="11"></circle>
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="${col}" stroke-width="11"
          stroke-linecap="round" stroke-dasharray="${(c * pct).toFixed(2)} ${c.toFixed(2)}"
          transform="rotate(-90 60 60)"></circle>
      </svg>
      <div class="ring-n"><b>${Math.round(score)}</b><span>/100</span></div>
    </div>`;
  }

  function phoneHtml() {
    const boxes = [0, 1, 2, 3, 4, 5].map((i) =>
      `<input inputmode="numeric" maxlength="1" autocomplete="one-time-code" aria-label="Digit ${i + 1}" data-otp="${i}">`
    ).join("");
    return `<div class="banner demo"><b>Demo mode.</b> No text message is sent. Enter any 6 digits to continue.</div>
      <div class="otp" id="otp">${boxes}</div>
      <p class="muted">On a real membership this step would text a one-time code. Nothing is sent from this preview.</p>`;
  }

  function otpValue() {
    return [...document.querySelectorAll("[data-otp]")].map((i) => i.value).join("");
  }

  function wireOtp(root) {
    const inputs = [...root.querySelectorAll("[data-otp]")];
    inputs.forEach((inp, idx) => {
      inp.addEventListener("input", () => {
        inp.value = (inp.value || "").replace(/\D/g, "").slice(-1);
        if (inp.value && inputs[idx + 1]) inputs[idx + 1].focus();
      });
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" && !inp.value && inputs[idx - 1]) inputs[idx - 1].focus();
      });
    });
    const otp = root.querySelector("#otp");
    if (!otp) return;
    otp.addEventListener("paste", (e) => {
      const text = ((e.clipboardData && e.clipboardData.getData("text")) || "").replace(/\D/g, "").slice(0, 6);
      if (!text) return;
      e.preventDefault();
      text.split("").forEach((ch, i) => { if (inputs[i]) inputs[i].value = ch; });
      inputs[Math.min(text.length, inputs.length) - 1].focus();
    });
  }

  function busy(on, msg) {
    const veil = document.getElementById("veil");
    if (!veil) return;
    veil.hidden = !on;
    const label = document.getElementById("veilmsg");
    if (label) label.textContent = msg || "Loading…";
    const next = document.getElementById("next");
    if (next) next.disabled = !!on;
  }

  function friendlyCarrier(err, label) {
    if (err && err.status === 404) {
      return "We couldn't find " + label + " in the FMCSA public census. Check the number — a USDOT is digits only (try 44110), and an MC looks like MC-1515.";
    }
    return (err && err.message) || "The FMCSA lookup didn't finish. Try again in a moment.";
  }

  window.CoRun = {
    esc, dash, money, scoreColor, FACTORS, load, save, api, ring,
    phoneHtml, otpValue, wireOtp, busy, friendlyCarrier,
  };
})();
