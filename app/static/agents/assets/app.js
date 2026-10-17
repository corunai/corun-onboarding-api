/* CoRun.ai insurance agency page: 3 scenarios + Violette onboarding assistant.
   All copy comes from content.json (or CORUN_CONFIG.contentUrl, e.g. a future /api/content endpoint).
   Links: ?s=renewal (default) | ?s=between-renewals | ?s=partner. UTM params go to HubSpot lead_campaign.
   No dependencies. HubSpot IDs live in the CONFIG block in index.html. */
(function () {
  'use strict';
  var CFG = window.CORUN_CONFIG || {};
  var qs = new URLSearchParams(location.search);
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeHref(h) { h = String(h || ''); return /^(https?:\/\/|\/|#|mailto:)/i.test(h) ? h : '#'; }

  /* ---------- campaign tracking (same format as /go, shared for the browser session) ---------- */
  var KEY = 'corun_campaign';
  var TRACK = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'];
  function readStore() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function writeStore(o) { try { sessionStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
  function captureCampaign() {
    var fromUrl = {}, any = false;
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

  /* ---------- HubSpot ---------- */
  function cookie(name) { var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; }
  function splitName(full) { var p = String(full || '').trim().split(/\s+/).filter(Boolean); return { first: p.shift() || '', last: p.join(' ') }; }
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  // answers: {role, agency, clients, usdot, contact:{name, contact}, ...any extra step ids}
  function buildPayload(a, scenario, steps, prefix) {
    var f = [];
    function add(n, v) { if (v !== undefined && v !== null && String(v).trim() !== '') f.push({ name: n, value: String(v).trim() }); }
    var c = a.contact || {}, n = splitName(c.name);
    add('firstname', n.first); add('lastname', n.last);
    add('company', a.agency);
    if (EMAIL_RE.test(c.contact || '')) add('email', c.contact); else add('phone', c.contact);
    add('corun_usdot', a.usdot);
    add('lead_source_page', (prefix || 'agencies-') + scenario);
    add('lead_campaign', campaignString(CAMPAIGN));
    var parts = [];
    if (a.role) parts.push('Role: ' + a.role);
    if (a.clients) parts.push('Trucking clients: ' + a.clients);
    (steps || []).forEach(function (s) {          // any extra steps the team adds in content.json
      if (['role', 'agency', 'clients', 'usdot', 'contact'].indexOf(s.id) < 0 && a[s.id]) parts.push((s.label || s.id) + ': ' + a[s.id]);
    });
    parts.push('Scenario: ' + scenario);
    parts.push('via Violette onboarding assistant');
    add('message', parts.join(' | '));
    var ctx = { pageUri: location.href, pageName: document.title };
    var hutk = cookie('hubspotutk'); if (hutk) ctx.hutk = hutk;
    return { fields: f, context: ctx };
  }
  function hubspotUrl() {
    return 'https://api.hsforms.com/submissions/v3/integration/submit/' +
      encodeURIComponent(CFG.hubspotPortalId) + '/' + encodeURIComponent(CFG.hubspotFormGuid);
  }
  function submit(payload) {
    if (!CFG.hubspotPortalId || !CFG.hubspotFormGuid || /REPLACE/i.test(CFG.hubspotFormGuid)) {
      console.warn('[CoRun.ai] HubSpot IDs missing in CORUN_CONFIG; lead NOT sent.', payload);
      return Promise.resolve({ placeholder: true });
    }
    // keepalive: the request finishes even if the visitor closes the tab right after Send.
    // credentials:'omit': HubSpot's CORS answer does not allow credentials.
    return fetch(hubspotUrl(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      keepalive: true, credentials: 'omit'
    }).then(function (r) { if (!r.ok) throw new Error('HubSpot ' + r.status); return r.json().catch(function () { return {}; }); });
  }

  /* ---------- content ---------- */
  function loadContent() {
    var primary = CFG.contentUrl || 'content.json';
    function get(u) { return fetch(u, { cache: 'no-cache', credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
    return get(primary).catch(function (e) {
      if (primary === 'content.json') throw e;
      console.warn('[CoRun.ai] contentUrl failed, using bundled content.json', e);
      return get('content.json');
    });
  }
  loadContent().then(init).catch(function (e) {
    console.error('[CoRun.ai] content failed to load', e);
    $('lead').textContent = 'This page could not load. Please refresh, or email nm@corun.ai.';
  });

  function init(C) {
    var key = (qs.get('s') || '').toLowerCase().trim();
    if (!C.scenarios[key]) key = C.settings.defaultScenario;
    var S = C.scenarios[key], H = C.shared, st = C.settings;
    document.documentElement.setAttribute('data-scenario', key);
    var title = S.headline.replace(/\.$/, '') + (H.pageTitleSuffix || ' | CoRun.ai');
    document.title = title;
    setMeta('meta[name=description]', S.subhead); setMeta('meta[property="og:title"]', title); setMeta('meta[property="og:description"]', S.subhead);
    if (H.skipLink) $('skiplink').textContent = H.skipLink;
    $('nav').innerHTML = H.nav.map(function (n) { return '<a href="' + esc(safeHref(n.href)) + '">' + esc(n.label) + '</a>'; }).join('') +
      '<a class="btn sm" href="#asst" data-to-asst>' + esc(S.cta) + '</a>';
    $('eyebrow').textContent = S.eyebrow; $('h1').textContent = S.headline; $('lead').textContent = S.subhead;
    $('pills').innerHTML = H.pills.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
    $('bt').textContent = S.benefitsTitle;
    $('benefits').innerHTML = S.benefits.map(function (b, i) {
      return '<div class="c">' + (key === 'partner' ? '<div class="n" aria-hidden="true">' + (i + 1) + '</div>' : '') + '<h3>' + esc(b.title) + '</h3><p>' + esc(b.text) + '</p></div>';
    }).join('');
    $('ht').textContent = H.howTitle;
    $('howg').innerHTML = H.how.map(function (b, i) { return '<li class="c"><div class="n" aria-hidden="true">' + (i + 1) + '</div><h3>' + esc(b.title) + '</h3><p>' + esc(b.text) + '</p></li>'; }).join('');
    $('tt').textContent = H.timelineTitle;
    $('tl').innerHTML = H.timeline.map(function (t) { return '<li class="t"><h3>' + esc(t.when) + '</h3><p>' + esc(t.text) + '</p></li>'; }).join('');
    $('ft').textContent = H.faqTitle;
    $('faql').innerHTML = H.faq.map(function (f, i) { return '<details' + (i ? '' : ' open') + '><summary>' + esc(f.q) + '</summary><p>' + esc(f.a) + '</p></details>'; }).join('');
    $('band').textContent = S.bandTitle; $('bandcta').textContent = S.cta; $('sticky').textContent = S.cta;
    $('foot').textContent = H.footer; $('priv').textContent = H.privacyLine;
    $('an').textContent = st.assistantName; $('ar').textContent = st.assistantRole;
    document.querySelectorAll('[data-to-asst]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); goToAssistant(); });
    });
    assistant(C, S, key);
  }
  function setMeta(sel, v) { var m = document.querySelector(sel); if (m) m.setAttribute('content', v); }
  function goToAssistant() {
    var a = $('asst'), reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    a.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    var f = a.querySelector('#inp button, #inp input, #inp a');
    (f || a).focus({ preventScroll: true });
  }

  /* ---------- Violette: scripted onboarding assistant ---------- */
  function assistant(C, S, key) {
    var steps = C.assistantSteps, L = C.assistantLabels || {}, H = C.shared, st = C.settings;
    var ans = {}, i = 0, log = $('log'), inp = $('inp'), err = $('err');
    var sent = false, sending = false; // send-once guard (phone-only leads can't be deduped by HubSpot)
    var delay = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300;
    function t(k, d) { return L[k] || d; }
    function bar() {
      var n = steps.length, done = i >= n;
      $('bar').innerHTML = steps.map(function (_, k) { return '<span class="' + (done ? 'ok' : k <= i ? 'on' : '') + '"></span>'; }).join('');
      $('prog').textContent = done ? 'DONE' : 'STEP ' + (i + 1) + ' OF ' + n;
      $('progsr').textContent = done ? '' : 'Step ' + (i + 1) + ' of ' + n;
    }
    function bot(html, cls) { var d = document.createElement('div'); d.className = 'm b' + (cls ? ' ' + cls : ''); d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; }
    function me(text) { var d = document.createElement('div'); d.className = 'm u'; d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; }
    function setErr(msg, field) {
      err.textContent = msg || '';
      inp.querySelectorAll('[aria-invalid]').forEach(function (x) { x.removeAttribute('aria-invalid'); });
      if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
    }
    function focusFirst() { var f = inp.querySelector('input, button'); if (f && document.activeElement && $('asst').contains(document.activeElement)) f.focus({ preventScroll: true }); }
    function ask() {
      bar();
      if (i >= steps.length) return;
      var s = steps[i]; bot(esc(s.ask)); setErr('');
      var qid = 'q' + i;
      log.lastChild.id = qid;
      if (s.type === 'choice') {
        inp.innerHTML = '<div class="chips" role="group" aria-labelledby="' + qid + '">' + s.options.map(function (o) { return '<button type="button">' + esc(o) + '</button>'; }).join('') + '</div>';
        inp.querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { answer(b.textContent); }); });
      } else if (s.type === 'text') {
        var isDot = s.id === 'usdot';
        inp.innerHTML = '<form class="row" novalidate><label class="sr-only" for="ti">' + esc(s.ask) + '</label>' +
          '<input id="ti" placeholder="' + esc(s.placeholder || '') + '"' + (isDot ? ' inputmode="numeric" maxlength="8" autocomplete="off"' : s.id === 'agency' ? ' autocomplete="organization"' : '') + ' aria-describedby="err">' +
          '<button class="btn sm" type="submit">' + esc(t('next', 'Next')) + '</button></form>' +
          (s.optional ? '<button class="skip" id="sk" type="button">' + esc(t('skip', 'Skip')) + '</button>' : '');
        inp.querySelector('form').addEventListener('submit', function (e) {
          e.preventDefault(); var el = $('ti'), v = el.value.trim();
          if (isDot) v = v.replace(/\s+/g, '');
          if (!v) { if (s.optional) return answer(t('skipped', 'Skipped'), ''); return setErr(t('textError', 'Please enter an answer.'), el); }
          if (isDot && !/^\d{1,8}$/.test(v)) return setErr(t('usdotError', 'Please enter digits only, up to 8.'), el);
          answer(v);
        });
        if (s.optional) $('sk').addEventListener('click', function () { answer(t('skipped', 'Skipped'), ''); });
      } else if (s.type === 'contact') {
        inp.innerHTML = '<form novalidate><label class="sr-only" for="cn">' + esc(t('namePlaceholder', 'Full name')) + '</label>' +
          '<input id="cn" placeholder="' + esc(t('namePlaceholder', 'Full name')) + '" autocomplete="name" aria-describedby="err">' +
          '<div class="row"><label class="sr-only" for="ce">' + esc(t('contactPlaceholder', 'Work email or phone')) + '</label>' +
          '<input id="ce" placeholder="' + esc(t('contactPlaceholder', 'Work email or phone')) + '" autocomplete="email" aria-describedby="err priv">' +
          '<button class="btn sm" id="cb" type="submit">' + esc(t('send', 'Send')) + '</button></div></form>';
        inp.querySelector('form').addEventListener('submit', function (e) {
          e.preventDefault(); if (sending || sent) return;
          var cn = $('cn'), ce = $('ce'), n = cn.value.trim(), c = ce.value.trim();
          if (!n) return setErr(t('nameError', 'Please enter your full name.'), cn);
          var ok = c.indexOf('@') > -1 ? EMAIL_RE.test(c) : c.replace(/\D/g, '').length >= 7;
          if (!ok) return setErr(t('contactError', 'Please enter a valid work email or phone number.'), ce);
          ans.contact = { name: n, contact: c };
          send($('cb'));
        });
      }
      setTimeout(focusFirst, 0);
    }
    function answer(display, value) {
      var s = steps[i]; ans[s.id] = value === undefined ? display : value; me(display);
      inp.innerHTML = ''; i++; setTimeout(ask, delay);
    }
    function send(btn) {
      sending = true; setErr('');
      btn.disabled = true; btn.textContent = t('sending', 'Sending…');
      var payload = buildPayload(ans, key, steps, st.leadSourcePrefix);
      window.__corunLastPayload = payload;
      submit(payload).then(function () {
        sent = true; sending = false;
        var c = ans.contact; me(c.name + ' · ' + c.contact); i = steps.length; finish();
      }).catch(function (e) {
        console.error(e); sending = false; btn.disabled = false; btn.textContent = t('send', 'Send');
        setErr(H.errorText || 'Something went wrong. Please try again.');
      });
    }
    function finish() {
      bar();
      var D = C.assistantDone, c = ans.contact || {}, sk = t('skipped', 'Skipped');
      bot('<p><b>' + esc(t('summaryTitle', 'Sent to the CoRun.ai team:')) + '</b></p><dl>' +
        '<dt>' + esc(t('summaryRole', 'Role')) + '</dt><dd>' + esc(ans.role || '') + '</dd>' +
        '<dt>' + esc(t('summaryAgency', 'Agency')) + '</dt><dd>' + esc(ans.agency || '') + '</dd>' +
        '<dt>' + esc(t('summaryClients', 'Trucking clients')) + '</dt><dd>' + esc(ans.clients || '') + '</dd>' +
        '<dt>' + esc(t('summaryUsdot', 'Client USDOT')) + '</dt><dd>' + esc(ans.usdot || sk) + '</dd>' +
        '<dt>' + esc(t('summaryContact', 'Contact')) + '</dt><dd>' + esc((c.name || '') + ' · ' + (c.contact || '')) + '</dd></dl>', 'sum');
      inp.innerHTML = '<div class="done" id="done" tabindex="-1"><div class="tick" aria-hidden="true">✓</div><h3>' + esc(D.title) + '</h3><p>' + esc(D.text) + '</p>' +
        '<a class="btn" href="' + esc(safeHref(CFG.onboardingUrl)) + '">' + esc(D.primary) + ' <span aria-hidden="true">→</span></a>' +
        '<a class="btn ghost" href="' + esc(safeHref(CFG.chatUrl)) + '">' + esc(D.secondary) + '</a></div>';
      $('done').focus({ preventScroll: true });
      $('asst').classList.add('is-done');
    }
    var g = S.assistant; bot(esc(g.greeting)); bot(esc(g.formPrompt));
    ask();
  }

  window.CoRunAgents = { buildPayload: buildPayload, campaign: function () { return CAMPAIGN; }, campaignString: campaignString };
})();

// Mobile sticky CTA hides while the assistant is on screen.
(function () {
  var a = document.getElementById('asst'), s = document.getElementById('sticky');
  if (!a || !s || !('IntersectionObserver' in window)) return;
  new IntersectionObserver(function (e) { s.classList.toggle('hide', e[0].isIntersecting); }).observe(a);
})();
