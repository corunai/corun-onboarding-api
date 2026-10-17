/* CoRun.ai campaign landing page — lead capture + campaign tracking.
   No dependencies. Reads CORUN_CONFIG from index.html. */
(function () {
  'use strict';
  var CFG = window.CORUN_CONFIG || (typeof CORUN_CONFIG !== 'undefined' ? CORUN_CONFIG : {});
  var AUD = document.documentElement.getAttribute('data-audience') || 'fleets';
  var ERR_MSG = 'Something went wrong. Please try again or email nm@corun.ai.';
  var KEY = 'corun_campaign';
  var TRACK = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'];

  /* ---------- campaign tracking (persisted for the browser session) ---------- */
  function readStore() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function writeStore(o) { try { sessionStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
  function captureCampaign() {
    var qs = new URLSearchParams(location.search), fromUrl = {}, any = false;
    TRACK.forEach(function (k) { var v = (qs.get(k) || '').trim(); if (v) { fromUrl[k] = v.slice(0, 200); any = true; } });
    var stored = readStore();
    var ref = document.referrer && document.referrer.indexOf(location.origin) !== 0 ? document.referrer : '';
    if (!stored) { fromUrl.referrer = ref; writeStore(fromUrl); return fromUrl; }
    if (any) { fromUrl.referrer = stored.referrer || ref; writeStore(fromUrl); return fromUrl; } // newer campaign click wins
    return stored;
  }
  var CAMPAIGN = captureCampaign();

  function campaignString(c) {
    var map = [['src', 'utm_source'], ['med', 'utm_medium'], ['cmp', 'utm_campaign'], ['cnt', 'utm_content'],
      ['term', 'utm_term'], ['gclid', 'gclid'], ['fbclid', 'fbclid'], ['ref', 'referrer']];
    return map.filter(function (m) { return c && c[m[1]]; })
      .map(function (m) { return m[0] + '=' + String(c[m[1]]).replace(/\|/g, '/'); }).join('|');
  }

  /* ---------- HubSpot payload ---------- */
  function cookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function splitName(full) {
    var parts = String(full || '').trim().split(/\s+/).filter(Boolean);
    return { first: parts.shift() || '', last: parts.join(' ') };
  }
  // data: {fullname, company, contact, usdot, email, message}
  function buildPayload(data, page) {
    var f = [];
    function add(n, v) { if (v !== undefined && v !== null && String(v).trim() !== '') f.push({ name: n, value: String(v).trim() }); }
    if (data.fullname) { var n = splitName(data.fullname); add('firstname', n.first); add('lastname', n.last); }
    add('company', data.company);
    if (data.email) add('email', data.email);
    else if (data.contact) { if (data.contact.indexOf('@') > -1) add('email', data.contact); else add('phone', data.contact); }
    add('corun_usdot', data.usdot);
    add('lead_source_page', page);
    add('lead_campaign', campaignString(CAMPAIGN));
    add('message', data.message);
    var ctx = { pageUri: location.href, pageName: document.title };
    var hutk = cookie('hubspotutk'); if (hutk) ctx.hutk = hutk;
    return { fields: f, context: ctx };
  }

  function isPlaceholder() { return !CFG.hubspotFormGuid || /REPLACE/i.test(CFG.hubspotFormGuid); }
  function submit(payload) {
    if (isPlaceholder()) {
      console.warn('[CoRun.ai] hubspotFormGuid is not set in CORUN_CONFIG; lead NOT sent. Payload:', payload);
      return Promise.resolve({ placeholder: true });
    }
    var url = 'https://api.hsforms.com/submissions/v3/integration/submit/' +
      encodeURIComponent(CFG.hubspotPortalId) + '/' + encodeURIComponent(CFG.hubspotFormGuid);
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { if (!r.ok) throw new Error('HubSpot ' + r.status); return r.json().catch(function () { return {}; }); });
  }

  // Fire-and-forget send used when the visitor leaves the page.
  // fetch(keepalive) is primary: sendBeacon always sends cookies (credentials: include) and HubSpot's
  // CORS preflight answers allow-credentials: false, so a JSON beacon is blocked while still reporting
  // success. sendBeacon is only a fallback for browsers without fetch keepalive.
  function beacon(payload) {
    if (isPlaceholder()) { console.warn('[CoRun.ai] hubspotFormGuid is not set; exit lead NOT sent. Payload:', payload); return; }
    var url = 'https://api.hsforms.com/submissions/v3/integration/submit/' +
      encodeURIComponent(CFG.hubspotPortalId) + '/' + encodeURIComponent(CFG.hubspotFormGuid);
    var body = JSON.stringify(payload);
    try {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true, credentials: 'omit' })
        .catch(function () {});
    } catch (e) {
      try { if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: 'application/json' })); } catch (e2) {}
    }
  }

  /* ---------- helpers ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function setErr(el, msg, field) {
    el.textContent = msg || '';
    document.querySelectorAll('[aria-invalid]').forEach(function (i) { i.removeAttribute('aria-invalid'); });
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
  }
  function busy(btn, on) {
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = 'Sending…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }
  function thanks(form) { form.classList.remove('two'); form.classList.add('done'); var t = $('s3'); if (t) t.focus(); }

  // Fleet Health Score links follow the config
  if (CFG.onboardingUrl) document.querySelectorAll('[data-onboarding]').forEach(function (a) { a.href = CFG.onboardingUrl; });

  var form = document.getElementById('signup');
  if (!form) return;

  if (form.dataset.form === 'fleets') {
    var lead = null;
    var phonePending = false; // phone-only lead captured at step 1 but not yet sent
    var phoneSent = false;    // guard: a phone lead is sent exactly once
    function stepTwoMessage() {
      var fs = form.querySelector('input[name=fs]:checked'), role = $('role').value, rm = $('rm').value, parts = [];
      if (fs) parts.push('Fleet size: ' + fs.value);
      if (role) parts.push('Role: ' + role);
      if (rm) parts.push('Renewal month: ' + rm);
      return parts.join('; ');
    }
    function phoneLeadData(withMessage) {
      var d = { fullname: lead.fullname, company: lead.company, usdot: lead.usdot, contact: lead.contact };
      if (withMessage) { var m = stepTwoMessage(); if (m) d.message = m; }
      return d;
    }
    // Visitor leaves after step 1 without Finish/Skip: send the step-1 lead once.
    function flushPhone() {
      if (!phonePending || phoneSent) return;
      phoneSent = true; phonePending = false;
      beacon(buildPayload(phoneLeadData(false), 'fleets'));
    }
    window.addEventListener('pagehide', flushPhone);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushPhone(); });
    // Finish/Skip for a phone lead: ONE combined submission.
    function sendPhoneCombined(btn, errEl, withMessage) {
      if (phoneSent) return thanks(form);
      phoneSent = true; phonePending = false;
      busy(btn, true); setErr(errEl, '');
      submit(buildPayload(phoneLeadData(withMessage), 'fleets'))
        .then(function () { busy(btn, false); thanks(form); })
        .catch(function (err) { console.error(err); phoneSent = false; phonePending = true; busy(btn, false); setErr(errEl, ERR_MSG); });
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fn = $('fn'), co = $('co'), dot = $('dot'), ct = $('ct'), e1 = $('e1'), b1 = $('b1');
      var name = fn.value.trim(), comp = co.value.trim(), usdot = dot.value.replace(/\s+/g, ''), contact = ct.value.trim();
      if (!name) return setErr(e1, 'Please enter your full name.', fn);
      if (!comp) return setErr(e1, 'Please enter your company name.', co);
      if (!/^\d{1,8}$/.test(usdot)) return setErr(e1, 'Please enter a valid USDOT number (digits only, up to 8).', dot);
      if (!contact) return setErr(e1, 'Please enter your email or phone number.', ct);
      if (contact.indexOf('@') > -1 ? !EMAIL_RE.test(contact) : contact.replace(/\D/g, '').length < 7)
        return setErr(e1, 'Please enter a valid email or phone number.', ct);
      setErr(e1, '');
      lead = { fullname: name, company: comp, usdot: usdot, contact: contact };
      if (contact.indexOf('@') < 0) {
        // Phone-only: HubSpot can't dedupe by phone, so hold the lead and send it once (Finish/Skip/leave).
        if (!phoneSent) phonePending = true;
        form.classList.add('two');
        return;
      }
      busy(b1, true);
      submit(buildPayload(lead, 'fleets'))
        .then(function () { busy(b1, false); form.classList.add('two'); })
        .catch(function (err) { console.error(err); busy(b1, false); setErr(e1, ERR_MSG); });
    });
    $('skip').addEventListener('click', function () {
      if (phonePending || (lead && lead.contact.indexOf('@') < 0 && !phoneSent)) return sendPhoneCombined($('skip'), $('e2'), false);
      thanks(form);
    });
    $('b2').addEventListener('click', function () {
      var b2 = $('b2'), e2 = $('e2');
      if (lead && lead.contact.indexOf('@') < 0) return sendPhoneCombined(b2, e2, true);
      var msg = stepTwoMessage();
      if (!msg || !lead) return thanks(form); // nothing to add
      busy(b2, true); setErr(e2, '');
      var d = { contact: lead.contact, message: msg };
      submit(buildPayload(d, 'fleets'))
        .then(function () { busy(b2, false); thanks(form); })
        .catch(function (err) { console.error(err); busy(b2, false); setErr(e2, ERR_MSG); });
    });
  } else {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var em = $('em'), ag = $('ag'), ea = $('ea'), ba = $('ba');
      var email = em.value.trim();
      if (!EMAIL_RE.test(email)) return setErr(ea, 'Please enter a valid work email.', em);
      setErr(ea, '');
      busy(ba, true);
      submit(buildPayload({ email: email, company: ag.value.trim() }, 'agencies'))
        .then(function () { busy(ba, false); thanks(form); })
        .catch(function (err) { console.error(err); busy(ba, false); setErr(ea, ERR_MSG); });
    });
  }

  // exposed for QA / debugging
  window.CoRunLanding = { buildPayload: buildPayload, campaign: function () { return CAMPAIGN; }, campaignString: campaignString };
})();
