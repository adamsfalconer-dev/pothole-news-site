/* ============================================================================
   POTHOLE NEWS — signal-theme · editions.js
   The P2 "editions" selector + P1 first-visit onboarding, no framework.
     · editions row: ALL · up to 3 chosen cities · ＋   (sliding orange-bar cursor)
     · ＋ opens a type-ahead popover over all 43 places (region-labelled)
     · picking a city persists to localStorage (max 3, oldest evicted) + navigates
     · first visit renders the onboarding card; "BUILD MY FEED" persists + dismisses
     · ✕ removes an edition; everything keyboard-accessible
     · also: transforms the *emphasis phrase* in headlines into <em class="sig">
   Reads window.POTHOLE_PLACES (assets/js/places.js). Budget: keep it small.
   ============================================================================ */
(function () {
  'use strict';

  var DATA = window.POTHOLE_PLACES || { regions: [], cities: [] };
  var CITIES = DATA.cities || [];
  var REGIONS = DATA.regions || [];
  var LS_ED = 'pothole:editions';
  var LS_ONB = 'pothole:onboarded';
  var MAX = 3;

  var bySlug = {};
  CITIES.forEach(function (c) { bySlug[c.slug] = c; });
  var regionById = {};
  REGIONS.forEach(function (r) { regionById[r.id] = r; });

  /* ---- base path + current place ------------------------------------------ */
  var homeLink = document.querySelector('.wordmark');
  var basePath = '';
  if (homeLink) {
    try { basePath = new URL(homeLink.href, location.href).pathname.replace(/\/+$/, ''); }
    catch (e) { basePath = ''; }
  }
  function cityUrl(slug) { return basePath + '/' + slug + '/'; }
  function homeUrl() { return basePath + '/'; }

  var rel = location.pathname.replace(/\/+$/, '').slice(basePath.length).replace(/^\/+/, '');
  var currentSlug = rel;                 // '' = home; a city slug; or region/post/page
  var isHome = currentSlug === '';
  var currentIsCity = !!bySlug[currentSlug];

  /* ---- storage ------------------------------------------------------------- */
  function getEditions() {
    try { return (JSON.parse(localStorage.getItem(LS_ED)) || []).filter(function (s) { return bySlug[s]; }); }
    catch (e) { return []; }
  }
  function setEditions(arr) {
    try { localStorage.setItem(LS_ED, JSON.stringify(arr.slice(-MAX))); } catch (e) {}
  }
  function isOnboarded() {
    try { return !!localStorage.getItem(LS_ONB); } catch (e) { return true; }
  }
  function markOnboarded() { try { localStorage.setItem(LS_ONB, '1'); } catch (e) {} }

  /* ---- small helpers ------------------------------------------------------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function regionLabel(city) {
    var r = regionById[city.region];
    return r ? r.label : '';
  }
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- headline emphasis: *phrase* -> <em class="sig">phrase</em> ---------- */
  function applyEmphasis() {
    var nodes = document.querySelectorAll('[data-emphasize]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute('data-emphasized')) continue;
      var raw = el.textContent;
      if (raw.indexOf('*') === -1) { el.setAttribute('data-emphasized', '1'); continue; }
      el.innerHTML = esc(raw).replace(/\*([^*]+)\*/g, '<em class="sig">$1</em>');
      el.setAttribute('data-emphasized', '1');
    }
  }

  /* ---- strip the *emphasis* markers from title/OG/meta (W1 carryover) -------
     The emphasis phrase is authored in the post title as *…* (deviation #3). The
     visible headline transforms it to <em class="sig">; here we also strip the raw
     asterisks from the browser tab title and the OG/Twitter meta so they never leak
     to a JS-running crawler or the tab. (The no-JS path is covered by the pipeline
     contract: meta_title / custom_excerpt are authored clean — see the W2 handoff.) */
  function stripMarkers(s) { return s ? s.replace(/\*([^*]+)\*/g, '$1') : s; }
  function sanitizeMeta() {
    if (document.title && document.title.indexOf('*') !== -1) document.title = stripMarkers(document.title);
    var sel = 'meta[property="og:title"],meta[name="twitter:title"],' +
              'meta[property="og:description"],meta[name="twitter:description"],meta[name="description"]';
    var tags = document.querySelectorAll(sel);
    for (var i = 0; i < tags.length; i++) {
      var c = tags[i].getAttribute('content');
      if (c && c.indexOf('*') !== -1) tags[i].setAttribute('content', stripMarkers(c));
    }
  }

  /* ---- editions row -------------------------------------------------------- */
  var firstSliderPaint = true;

  function activeKey() {
    if (isHome) return 'all';
    if (currentIsCity) return currentSlug;
    return null; // region / post / page — no chip active
  }

  function renderRow() {
    var nav = document.querySelector('[data-editions]');
    if (!nav) return;
    var eds = getEditions();
    var display = eds.slice();
    if (currentIsCity && display.indexOf(currentSlug) === -1) display.push(currentSlug); // show where you are
    var active = activeKey();

    var html = '<a class="ed' + (active === 'all' ? ' is-on' : '') + '" href="' + esc(homeUrl()) + '" data-ed-all>ALL</a>';
    display.forEach(function (slug) {
      var c = bySlug[slug];
      if (!c) return;
      html += '<span class="ed' + (active === slug ? ' is-on' : '') + '" data-ed-slug="' + esc(slug) + '">' +
        '<a class="ed__link" href="' + esc(cityUrl(slug)) + '">' + esc(c.name) + '</a>' +
        '<button class="ed__x" type="button" data-ed-x="' + esc(slug) + '" aria-label="Remove ' + esc(c.name) + '">&#10005;</button>' +
        '</span>';
    });
    html += '<button class="ed ed--plus" type="button" data-ed-plus aria-haspopup="dialog" aria-expanded="false" aria-label="Add a city">&#65291;</button>';
    nav.innerHTML = html;
    positionSlider();
  }

  function positionSlider() {
    var nav = document.querySelector('[data-editions]');
    var slider = document.querySelector('[data-ed-slider]');
    if (!nav || !slider) return;
    var on = nav.querySelector('.ed.is-on');
    if (firstSliderPaint || reduceMotion) slider.style.transition = 'none';
    if (!on) { slider.style.width = '0px'; }
    else {
      var navRect = nav.getBoundingClientRect();
      var r = on.getBoundingClientRect();
      slider.style.left = Math.max(0, r.left - navRect.left) + 'px';
      slider.style.width = r.width + 'px';
    }
    if (firstSliderPaint && !reduceMotion) {
      // re-enable the transition on the next frame so future moves animate
      requestAnimationFrame(function () { slider.style.transition = ''; });
      firstSliderPaint = false;
    }
  }

  /* ---- the ＋ popover (type-ahead over all 43 places) ---------------------- */
  var pop, popInput, popList, popActiveIndex = -1;

  function buildPopover() {
    var masthead = document.querySelector('.masthead');
    if (!masthead) return;
    masthead.style.position = 'relative';
    pop = document.createElement('div');
    pop.className = 'pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Add a city');
    pop.hidden = true;
    pop.innerHTML =
      '<div class="pop__search"><span aria-hidden="true">&#128269;</span>' +
      '<input type="text" placeholder="Find your city…" aria-label="Find your city" data-pop-input autocomplete="off"></div>' +
      '<div class="pop__list" role="listbox" data-pop-list></div>' +
      '<p class="pop__cap">Up to 3 editions · &#10005; retires one · full atlas in the footer</p>';
    masthead.appendChild(pop);
    popInput = pop.querySelector('[data-pop-input]');
    popList = pop.querySelector('[data-pop-list]');
    popInput.addEventListener('input', function () { fillList(popInput.value); });
    popInput.addEventListener('keydown', onPopKeydown);
    pop.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePopover(); });
  }

  function openPopover(plusBtn) {
    if (!pop) buildPopover();
    var mast = document.querySelector('.masthead').getBoundingClientRect();
    var pb = plusBtn.getBoundingClientRect();
    pop.style.top = (pb.bottom - mast.top + 6) + 'px';
    var left = pb.left - mast.left - 260;
    pop.style.left = Math.max(0, left) + 'px';
    pop.hidden = false;
    plusBtn.setAttribute('aria-expanded', 'true');
    popInput.value = '';
    fillList('');
    popInput.focus();
    document.addEventListener('click', outsideClose, true);
  }
  function closePopover() {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    popActiveIndex = -1;
    document.removeEventListener('click', outsideClose, true);
    var plus = document.querySelector('[data-ed-plus]');
    if (plus) { plus.setAttribute('aria-expanded', 'false'); plus.focus(); }
  }
  function outsideClose(e) {
    if (pop.contains(e.target) || e.target.closest('[data-ed-plus]')) return;
    closePopover();
  }

  function fillList(q) {
    var eds = getEditions();
    var query = q.toLowerCase().trim();
    var matches = CITIES.filter(function (c) {
      return c.name.toLowerCase().indexOf(query) !== -1 && eds.indexOf(c.slug) === -1;
    }).slice(0, 9);
    popActiveIndex = -1;
    if (!matches.length) {
      popList.innerHTML = '<p class="pop__empty">No match — try the footer atlas.</p>';
      return;
    }
    popList.innerHTML = matches.map(function (c) {
      return '<button class="pop__row" type="button" role="option" data-pick="' + esc(c.slug) + '">' +
        '<span class="pop__n">&#65291; ' + esc(c.name) + '</span>' +
        '<span class="pop__r">' + esc(regionLabel(c)) + '</span></button>';
    }).join('');
  }

  function popRows() { return popList.querySelectorAll('.pop__row'); }
  function onPopKeydown(e) {
    var rows = popRows();
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(rows, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(rows, -1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      var target = popActiveIndex >= 0 ? rows[popActiveIndex] : rows[0];
      if (target) pickCity(target.getAttribute('data-pick'));
    }
  }
  function moveActive(rows, dir) {
    if (!rows.length) return;
    if (popActiveIndex >= 0 && rows[popActiveIndex]) rows[popActiveIndex].classList.remove('is-active');
    popActiveIndex = (popActiveIndex + dir + rows.length) % rows.length;
    rows[popActiveIndex].classList.add('is-active');
    rows[popActiveIndex].scrollIntoView({ block: 'nearest' });
  }

  /* ---- pick / remove ------------------------------------------------------- */
  function pickCity(slug) {
    if (!bySlug[slug]) return;
    var eds = getEditions().filter(function (s) { return s !== slug; });
    eds.push(slug);
    if (eds.length > MAX) eds = eds.slice(eds.length - MAX);   // oldest evicted
    setEditions(eds);
    location.href = cityUrl(slug);
  }
  function removeCity(slug) {
    var eds = getEditions().filter(function (s) { return s !== slug; });
    setEditions(eds);
    if (currentSlug === slug) { location.href = homeUrl(); return; }
    renderRow();
  }

  /* ---- row event delegation ------------------------------------------------ */
  function bindRow() {
    var nav = document.querySelector('[data-editions]');
    if (!nav) return;
    nav.addEventListener('click', function (e) {
      var x = e.target.closest('[data-ed-x]');
      if (x) { e.preventDefault(); removeCity(x.getAttribute('data-ed-x')); return; }
      var plus = e.target.closest('[data-ed-plus]');
      if (plus) {
        e.preventDefault();
        if (pop && !pop.hidden) closePopover(); else openPopover(plus);
      }
    });
    popList && popList.addEventListener('click', function (e) {
      var row = e.target.closest('[data-pick]');
      if (row) pickCity(row.getAttribute('data-pick'));
    });
  }

  /* ---- first-visit onboarding card (P1) ------------------------------------ */
  function renderOnboarding() {
    var slot = document.querySelector('[data-onboarding-slot]');
    if (!slot || !isHome || isOnboarded()) return;

    var selected = [];
    // The static build server-renders the card into the slot (so it paints with
    // the page — zero CLS). If it's already there, WIRE it; otherwise (e.g. the
    // Ghost path with an empty slot) inject it as before.
    var card = slot.querySelector('.onb');
    if (!card) {
      card = document.createElement('div');
      card.className = 'onb';
      var groups = REGIONS.map(function (r) {
        var chips = CITIES.filter(function (c) { return c.region === r.id; }).map(function (c) {
          return '<button class="cchip" type="button" aria-pressed="false" data-onb="' + esc(c.slug) + '">' + esc(c.name) + '</button>';
        }).join('');
        return '<div class="onb__region">' + esc(r.label) + '</div><div class="onb__chips">' + chips + '</div>';
      }).join('');
      card.innerHTML =
        '<h2 class="onb__title">Where do you live? <em>Pick up to three.</em></h2>' +
        '<p class="onb__sub">We cover 43 cities and communities across the San Gabriel &amp; Pomona Valleys. Choose yours — the feed remembers.</p>' +
        groups +
        '<div><button class="onb__go" type="button" data-onb-go>BUILD MY FEED &rarr;</button>' +
        '<span class="onb__count" data-onb-count></span></div>';
      slot.appendChild(card);
    }

    var countEl = card.querySelector('[data-onb-count]');
    function refresh() {
      countEl.textContent = selected.length ? selected.length + ' of 3 chosen' : '';
      card.querySelectorAll('[data-onb]').forEach(function (b) {
        var on = selected.indexOf(b.getAttribute('data-onb')) !== -1;
        b.disabled = (!on && selected.length >= MAX);
      });
    }
    card.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-onb]');
      if (chip) {
        var slug = chip.getAttribute('data-onb');
        var i = selected.indexOf(slug);
        if (i !== -1) { selected.splice(i, 1); chip.setAttribute('aria-pressed', 'false'); }
        else if (selected.length < MAX) { selected.push(slug); chip.setAttribute('aria-pressed', 'true'); }
        refresh();
        return;
      }
      if (e.target.closest('[data-onb-go]')) {
        setEditions(selected.slice(0, MAX));
        markOnboarded();
        card.remove();
        renderRow();
      }
    });
  }

  /* ---- init ---------------------------------------------------------------- */
  function init() {
    applyEmphasis();
    sanitizeMeta();
    renderRow();
    bindRow();
    renderOnboarding();
    window.addEventListener('resize', positionSlider);
    window.addEventListener('load', positionSlider);
    // re-place the cursor once late (web fonts can change chip widths)
    setTimeout(positionSlider, 350);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
