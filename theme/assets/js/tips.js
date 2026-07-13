/* ============================================================================
   POTHOLE NEWS — signal-theme · tips.js
   Report-a-Pothole, the 3-step tip line (frozen UX v3 §3). No framework.
     step 1  city grid (built from window.POTHOLE_PLACES)
     step 2  severity: surface crack / pothole / sinkhole   (triage)
     step 3  details + optional contact  →  "Crew dispatched"
   Submission: POSTs to ENDPOINT (city + severity in the payload/subject). With no
   ENDPOINT set it falls back to a prefilled mailto to the desk. No account, no CAPTCHA.
   ----------------------------------------------------------------------------
   OPERATOR SETUP (a TJ step — see HANDOFF-…-web-W2.md, ~2 min, no code):
     1. Get a free Web3Forms access key at https://web3forms.com (email → key).
     2. Set ENDPOINT = 'https://api.web3forms.com/submit' and ACCESS_KEY = '<key>'.
     3. Point the Web3Forms key's destination at assignmentdesk26@gmail.com.
   Leave both blank to keep the mailto fallback (works today, zero setup).
   ============================================================================ */
(function () {
  'use strict';

  /* ---- CONFIG (operator sets these; blank = mailto fallback) --------------- */
  var ENDPOINT = 'https://api.web3forms.com/submit';                                   // e.g. 'https://api.web3forms.com/submit'
  var ACCESS_KEY = 'c64c1b56-33e7-43c2-9194-92a14edfccc7';                                 // Web3Forms access key (or your relay token)
  var DESK_EMAIL = 'assignmentdesk26@gmail.com';       // mailto fallback destination

  var form = document.querySelector('[data-tip]');
  if (!form) return;

  var DATA = window.POTHOLE_PLACES || { regions: [], cities: [] };
  var CITIES = DATA.cities || [];

  var cityField = form.querySelector('[data-tip-city]');
  var sevField = form.querySelector('[data-tip-severity]');
  var errorEl = form.querySelector('[data-tip-error]');
  var doneEl = form.querySelector('[data-tip-done]');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---- step 1: the city grid ----------------------------------------------
     Normally server-rendered by partials/tip-cities.hbs (no layout shift, no-JS
     friendly). This only rebuilds it from places.js as a fallback if the partial
     is missing/empty — never the common path. */
  function buildCities() {
    var box = form.querySelector('[data-tip-cities]');
    if (!box || box.querySelector('[data-tip-pick]')) return;   // already server-rendered
    var html = CITIES.map(function (c) {
      return '<button class="tip__opt" type="button" data-tip-pick="' + esc(c.name) + '">' + esc(c.name) + '</button>';
    }).join('');
    html += '<button class="tip__opt" type="button" data-tip-pick="A school district">A school district</button>';
    html += '<button class="tip__opt" type="button" data-tip-pick="Not sure / elsewhere in the valley">Not sure</button>';
    box.innerHTML = html;
  }

  /* ---- step machine -------------------------------------------------------- */
  function stepEl(n) { return form.querySelector('[data-tip-step="' + n + '"]'); }

  function goStep(n) {
    [1, 2, 3].forEach(function (i) {
      var s = stepEl(i);
      if (s) { s.hidden = (i !== n); s.classList.toggle('is-on', i === n); }
      var seg = form.querySelector('[data-tip-seg="' + i + '"]');
      if (seg) seg.classList.toggle('is-on', i <= n);
    });
    if (doneEl) doneEl.hidden = true;
    var active = stepEl(n);
    if (active) {
      var focusable = active.querySelector('legend') || active.querySelector('button, textarea, input');
      // legends aren't focusable; move focus to the first real control instead
      var ctrl = active.querySelector('.tip__opt, textarea, .tip__send');
      if (ctrl) { try { ctrl.focus({ preventScroll: false }); } catch (e) { ctrl.focus(); } }
      else if (focusable) focusable.scrollIntoView({ block: 'nearest' });
    }
    if (errorEl) { errorEl.hidden = true; }
  }

  /* ---- events -------------------------------------------------------------- */
  form.addEventListener('click', function (e) {
    var pick = e.target.closest('[data-tip-pick]');
    if (pick) { cityField.value = pick.getAttribute('data-tip-pick'); goStep(2); return; }

    var sev = e.target.closest('[data-tip-sev]');
    if (sev) { sevField.value = sev.getAttribute('data-tip-sev'); goStep(3); return; }

    var back = e.target.closest('[data-tip-back]');
    if (back) { e.preventDefault(); goStep(parseInt(back.getAttribute('data-tip-back'), 10)); return; }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var details = (form.querySelector('#tip-details') || {}).value || '';
    var contact = (form.querySelector('#tip-contact') || {}).value || '';
    var city = cityField.value || 'Unspecified';
    var severity = sevField.value || 'unspecified';

    if (!details.trim()) {
      if (errorEl) { errorEl.textContent = 'Tell us what you know first — even a sentence.'; errorEl.hidden = false; }
      var ta = form.querySelector('#tip-details');
      if (ta) ta.focus();
      return;
    }

    var subject = '[TIP · ' + severity + '] ' + city;
    var send = form.querySelector('[data-tip-send]');
    if (send) { send.disabled = true; send.textContent = 'Sending…'; }

    if (ENDPOINT) {
      var payload = {
        subject: subject, from_name: 'Pothole News tip line',
        city: city, severity: severity, details: details, contact: contact
      };
      if (ACCESS_KEY) payload.access_key = ACCESS_KEY;
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) {
        if (!r.ok) throw new Error('bad status');
        succeed();
      }).catch(function () {
        // network/endpoint failure → don't lose the tip: fall back to mailto
        mailtoFallback(subject, city, severity, details, contact);
        succeed();
      });
    } else {
      mailtoFallback(subject, city, severity, details, contact);
      succeed();
    }
  });

  function mailtoFallback(subject, city, severity, details, contact) {
    var body = details + '\n\n— — —\nPlace: ' + city + '\nSeverity: ' + severity +
      (contact ? '\nContact: ' + contact : '\nContact: (none left)') +
      '\n\nSent from the Pothole News tip line.';
    var href = 'mailto:' + DESK_EMAIL + '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body);
    // open the user's mail client without navigating the page away
    var a = document.createElement('a');
    a.href = href; a.style.display = 'none';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function succeed() {
    [1, 2, 3].forEach(function (i) { var s = stepEl(i); if (s) s.hidden = true; });
    form.querySelectorAll('[data-tip-seg]').forEach(function (seg) { seg.classList.add('is-on'); });
    if (doneEl) { doneEl.hidden = false; doneEl.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }

  /* ---- init ---------------------------------------------------------------- */
  buildCities();
  goStep(1);
})();
