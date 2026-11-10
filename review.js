// Content Machine review page: shows a post the way Instagram would (carousel + caption) and lets anyone with the
// link tap a slide to drop a numbered circle and leave a note there. The review's code is in the address after #.
(() => {
  const { url: API, key: KEY } = window.CM_REVIEW;
  const token = decodeURIComponent(location.hash.slice(1)).trim();
  const app = document.getElementById('app');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

  let R = null;          // the review
  let at = 0;            // slide shown
  let draft = null;      // { slide, x, y } while a note is being written
  let openPin = null;    // id of the note whose bubble is open
  let showPins = true;
  let showResolved = false;
  let captionOpen = false;

  async function rpc(name, args) {
    const r = await fetch(`${API}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` }, body: JSON.stringify(args),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error((j && (j.message || j.error)) || `Error ${r.status}`);
    return j;
  }

  const ago = (t) => {
    const s = (Date.now() - new Date(t)) / 1000;
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    if (s < 604800) return `${Math.floor(s / 86400)}d`;
    return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  };
  // Hashtags and @mentions coloured like Instagram; line breaks kept
  const rich = (s) => esc(s).replace(/(^|[\s(])([#@][\p{L}\p{N}_.]+)/gu, '$1<span class="rv-tag">$2</span>').replace(/\n/g, '<br>');

  // Instagram crops every slide to the first one's shape, between 1.91:1 and 4:5
  const ratio = () => {
    const s = R.slides[0];
    const r = s && s.w && s.h ? s.w / s.h : 0.8;
    return Math.min(1.91, Math.max(0.8, r));
  };
  const visible = () => R.comments.filter((c) => showResolved || !c.resolved);
  const numberOf = (c) => R.comments.indexOf(c) + 1;

  /* ---------- drawing ---------- */
  function draw() {
    const acct = R.account || 'yourpage';
    const open = R.comments.filter((c) => !c.resolved).length;
    const resolved = R.comments.length - open;
    app.innerHTML = `
      <div class="rv-wrap">
        <section class="rv-post">
          <header class="rv-head">
            <div class="rv-avatar"><span>${esc(acct[0] || '?').toUpperCase()}</span></div>
            <div class="rv-who"><b>${esc(acct)}</b><small>Original audio</small></div>
            <div class="rv-dots-menu">•••</div>
          </header>
          <div class="rv-frame" style="aspect-ratio:${ratio()}">
            <div class="rv-track" id="rvTrack">${R.slides.map((s, i) => `<div class="rv-slide" data-i="${i}"><img src="${esc(s.url)}" alt="Slide ${i + 1}" draggable="false"${i > 1 ? ' loading="lazy"' : ''}></div>`).join('')}</div>
            <div class="rv-pins" id="rvPins"></div>
            ${R.slides.length > 1 ? `<div class="rv-count">${at + 1}/${R.slides.length}</div>
              <button class="rv-arrow rv-prev" aria-label="Previous slide" ${at === 0 ? 'hidden' : ''}>‹</button>
              <button class="rv-arrow rv-next" aria-label="Next slide" ${at === R.slides.length - 1 ? 'hidden' : ''}>›</button>` : ''}
          </div>
          <div class="rv-actions">
            <span class="rv-icons">${ICONS.heart}${ICONS.comment}${ICONS.share}</span>
            ${R.slides.length > 1 ? `<span class="rv-dots">${R.slides.map((_, i) => `<i class="${i === at ? 'on' : ''}"></i>`).join('')}</span>` : '<span></span>'}
            <span class="rv-save">${ICONS.save}</span>
          </div>
          <div class="rv-caption" id="rvCaption">${captionHtml(acct)}</div>
          <div class="rv-when">${esc(new Date(R.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }))}</div>
        </section>

        <aside class="rv-side">
          <div class="rv-help"><b>Leave a note:</b> tap anywhere on a slide. A circle goes where you tapped, then type what should change there. Swipe or use the arrows to see every slide.</div>
          <div class="rv-tools">
            <label><input type="checkbox" id="rvShow" ${showPins ? 'checked' : ''}> Show notes on the slides</label>
            ${resolved ? `<label><input type="checkbox" id="rvResolved" ${showResolved ? 'checked' : ''}> Show ${resolved} done</label>` : ''}
          </div>
          <h2>Notes <span>${open ? `${open} open` : 'none yet'}</span></h2>
          <div class="rv-list" id="rvList">${notesList()}</div>
        </aside>
      </div>`;
    wire();
    place(false);
    drawPins();
  }

  // Like Instagram: the first line (up to 125 characters), then "… more" opens the whole caption
  function captionHtml(acct) {
    const text = R.caption || '';
    const nl = text.indexOf('\n');
    const cut = Math.min(nl === -1 ? text.length : nl, 125);
    const short = cut < text.trimEnd().length;
    if (captionOpen || !short) return `<b>${esc(acct)}</b> ${rich(text)}`;
    return `<b>${esc(acct)}</b> ${rich(text.slice(0, cut).trimEnd())}<button class="rv-more" id="rvMore">… more</button>`;
  }

  function notesList() {
    const list = visible();
    if (!list.length) return '<p class="rv-empty">No notes yet. Tap a slide to add the first one.</p>';
    return R.slides.map((_, i) => {
      const mine = list.filter((c) => c.slide === i);
      if (!mine.length) return '';
      return `<div class="rv-group"><h3>Slide ${i + 1}</h3>${mine.map((c) => `
        <button class="rv-note ${c.resolved ? 'done' : ''} ${openPin === c.id ? 'on' : ''}" data-id="${c.id}">
          <span class="rv-num">${numberOf(c)}</span>
          <span class="rv-note-text"><b>${esc(c.author || 'Someone')}</b> <small>${ago(c.created_at)}${c.resolved ? ' · done' : ''}</small><br>${esc(c.body).replace(/\n/g, '<br>')}</span>
        </button>`).join('')}</div>`;
    }).join('');
  }

  function drawPins() {
    const box = document.getElementById('rvPins');
    if (!box) return;
    const pins = showPins ? visible().filter((c) => c.slide === at) : [];
    let html = pins.map((c) => `<button class="rv-pin ${c.resolved ? 'done' : ''} ${openPin === c.id ? 'on' : ''}" data-id="${c.id}" style="left:${c.x * 100}%;top:${c.y * 100}%">${numberOf(c)}</button>`).join('');
    const opened = pins.find((c) => c.id === openPin);
    if (opened) html += bubble(opened.x, opened.y, `<div class="rv-bubble-read"><b>${esc(opened.author || 'Someone')}</b> <small>${ago(opened.created_at)}</small><p>${esc(opened.body).replace(/\n/g, '<br>')}</p></div>`);
    if (draft && draft.slide === at) {
      const name = store.get('cm-review-name') || '';
      html += `<div class="rv-pin draft" style="left:${draft.x * 100}%;top:${draft.y * 100}%">${R.comments.length + 1}</div>`;
      html += bubble(draft.x, draft.y, `<form class="rv-form" id="rvForm">
        <textarea id="rvBody" rows="3" maxlength="1000" placeholder="What should change here?" required></textarea>
        <input id="rvName" maxlength="60" placeholder="Your name" value="${esc(name)}" required>
        <div class="rv-form-row"><button type="button" class="rv-btn" id="rvCancel">Cancel</button><button class="rv-btn primary" id="rvPost">Post note</button></div>
        <div class="rv-err" id="rvErr"></div></form>`);
    }
    box.innerHTML = html;
    box.querySelectorAll('.rv-pin[data-id]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openPin = openPin === b.dataset.id ? null : b.dataset.id; draft = null; refreshNotes(); drawPins(); }));
    box.querySelectorAll('.rv-bubble').forEach((b) => ['pointerdown', 'click'].forEach((ev) => b.addEventListener(ev, (e) => e.stopPropagation())));
    const form = document.getElementById('rvForm');
    if (form) {
      const body = document.getElementById('rvBody');
      setTimeout(() => body.focus({ preventScroll: true }), 30);
      document.getElementById('rvCancel').onclick = () => { draft = null; drawPins(); };
      body.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit(); if (e.key === 'Escape') { draft = null; drawPins(); } };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const text = body.value.trim();
        const who = document.getElementById('rvName').value.trim();
        if (!text || !who) return;
        store.set('cm-review-name', who);
        const btn = document.getElementById('rvPost');
        btn.disabled = true;
        btn.textContent = 'Posting…';
        try {
          const c = await rpc('add_comment', { p_token: token, p_slide: draft.slide, p_x: draft.x, p_y: draft.y, p_body: text, p_author: who });
          R.comments.push(c);
          draft = null;
          openPin = c.id;
          refreshNotes();
          drawPins();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Post note';
          document.getElementById('rvErr').textContent = `Couldn't post that: ${err.message}. Try again.`;
        }
      };
    }
  }

  // A speech bubble next to a point, kept inside the slide
  function bubble(x, y, inner) {
    const side = x > 0.55 ? 'left' : 'right';
    const v = y > 0.6 ? 'up' : 'down';
    return `<div class="rv-bubble ${side} ${v}" style="${side === 'right' ? `left:${x * 100}%` : `right:${(1 - x) * 100}%`};${v === 'down' ? `top:${y * 100}%` : `bottom:${(1 - y) * 100}%`}">${inner}</div>`;
  }

  function refreshNotes() {
    const list = document.getElementById('rvList');
    if (list) list.innerHTML = notesList();
    wireNotes();
    const h = document.querySelector('.rv-side h2 span');
    const open = R.comments.filter((c) => !c.resolved).length;
    if (h) h.textContent = open ? `${open} open` : 'none yet';
  }

  /* ---------- carousel ---------- */
  function place(animate = true) {
    const track = document.getElementById('rvTrack');
    if (!track) return;
    track.style.transition = animate ? 'transform .28s ease' : 'none';
    track.style.transform = `translateX(${-at * 100}%)`;
    const c = document.querySelector('.rv-count');
    if (c) c.textContent = `${at + 1}/${R.slides.length}`;
    document.querySelectorAll('.rv-dots i').forEach((d, i) => d.classList.toggle('on', i === at));
    const p = document.querySelector('.rv-prev'), n = document.querySelector('.rv-next');
    if (p) p.hidden = at === 0;
    if (n) n.hidden = at === R.slides.length - 1;
  }
  function go(i) {
    const next = Math.max(0, Math.min(R.slides.length - 1, i));
    if (next === at) return place();
    at = next;
    if (draft && draft.slide !== at) draft = null;
    if (openPin && !R.comments.some((c) => c.id === openPin && c.slide === at)) openPin = null;
    place();
    drawPins();
  }

  function wire() {
    const frame = document.querySelector('.rv-frame');
    const track = document.getElementById('rvTrack');
    let start = null;
    frame.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.rv-arrow, .rv-pin, .rv-bubble')) return;
      start = { x: e.clientX, y: e.clientY, w: frame.clientWidth, moved: false, id: e.pointerId };
    });
    frame.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      if (!start.moved && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(e.clientY - start.y)) {
        start.moved = true;
        try { frame.setPointerCapture(e.pointerId); } catch { /* fine */ }
      }
      if (start.moved) {
        const edge = (at === 0 && dx > 0) || (at === R.slides.length - 1 && dx < 0) ? 0.3 : 1;
        track.style.transition = 'none';
        track.style.transform = `translateX(calc(${-at * 100}% + ${dx * edge}px))`;
      }
    });
    const end = (e) => {
      if (!start || e.pointerId !== start.id) return;
      const s = start;
      start = null;
      if (s.moved) {
        const dx = e.clientX - s.x;
        if (Math.abs(dx) > s.w * 0.18) go(at + (dx < 0 ? 1 : -1));
        else place();
        return;
      }
      if (e.type === 'pointercancel') return;
      // a tap: drop a new note where it landed
      const r = frame.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      if (openPin) { openPin = null; refreshNotes(); }
      draft = { slide: at, x: +x.toFixed(4), y: +y.toFixed(4) };
      if (!showPins) { showPins = true; const sp = document.getElementById('rvShow'); if (sp) sp.checked = true; }
      drawPins();
    };
    frame.addEventListener('pointerup', end);
    frame.addEventListener('pointercancel', end);
    const prev = document.querySelector('.rv-prev'), next = document.querySelector('.rv-next');
    if (prev) prev.onclick = (e) => { e.stopPropagation(); go(at - 1); };
    if (next) next.onclick = (e) => { e.stopPropagation(); go(at + 1); };
    const more = document.getElementById('rvMore');
    if (more) more.onclick = () => { captionOpen = true; document.getElementById('rvCaption').innerHTML = captionHtml(R.account || 'yourpage'); };
    document.getElementById('rvShow').onchange = (e) => { showPins = e.target.checked; if (!showPins) { draft = null; openPin = null; } drawPins(); };
    const res = document.getElementById('rvResolved');
    if (res) res.onchange = (e) => { showResolved = e.target.checked; refreshNotes(); drawPins(); };
    wireNotes();
  }
  function wireNotes() {
    document.querySelectorAll('.rv-note').forEach((b) => (b.onclick = () => {
      const c = R.comments.find((x) => x.id === b.dataset.id);
      if (!c) return;
      openPin = c.id;
      draft = null;
      showPins = true;
      const sp = document.getElementById('rvShow');
      if (sp) sp.checked = true;
      go(c.slide);
      refreshNotes();
      drawPins();
      if (window.innerWidth < 900) document.querySelector('.rv-frame').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
  }
  document.addEventListener('keydown', (e) => {
    if (!R || e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight') go(at + 1);
    if (e.key === 'ArrowLeft') go(at - 1);
    if (e.key === 'Escape' && (draft || openPin)) { draft = null; openPin = null; refreshNotes(); drawPins(); }
  });

  /* ---------- loading, and picking up other people's notes ---------- */
  async function load(first) {
    const r = await rpc('get_review', { p_token: token });
    if (!r) throw new Error('missing');
    if (first) {
      R = r;
      document.title = `${r.title || 'Post'} · review`;
      return draw();
    }
    const known = new Set(R.comments.map((c) => c.id));
    const changed = r.comments.length !== R.comments.length || r.comments.some((c) => !known.has(c.id) || R.comments.find((x) => x.id === c.id).resolved !== c.resolved) || r.caption !== R.caption;
    if (!changed) return;
    const captionChanged = r.caption !== R.caption;
    R = r;
    if (captionChanged && !draft) return draw();
    refreshNotes();
    if (!draft) drawPins();
  }

  if (!token) {
    app.innerHTML = '<div class="rv-loading">This review link is missing its code. Ask for the link again.</div>';
    return;
  }
  load(true).catch((e) => {
    app.innerHTML = `<div class="rv-loading">${e.message === 'missing' ? 'This review has been removed, or the link is wrong.' : `Couldn't load the post (${esc(e.message)}). Refresh to try again.`}</div>`;
  });
  setInterval(() => { if (R && !document.hidden) load(false).catch(() => {}); }, 15000);
  document.addEventListener('visibilitychange', () => { if (R && !document.hidden) load(false).catch(() => {}); });

  const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round" ${extra}>${d}</svg>`;
  const ICONS = {
    heart: svg('<path d="M12 20.5s-7.5-4.6-9.3-9.6C1.5 7.4 3.6 4 7.1 4c2 0 3.6 1.1 4.9 3 1.3-1.9 2.9-3 4.9-3 3.5 0 5.6 3.4 4.4 6.9-1.8 5-9.3 9.6-9.3 9.6z"/>'),
    comment: svg('<path d="M20.7 16.4A9 9 0 1 0 17 20l3.9 1-1.2-4.6z"/>'),
    share: svg('<path d="M22 3 9.2 10.1M22 3l-7 18-3.8-8.9L2 8.6z"/>'),
    save: svg('<path d="M19 21l-7-6-7 6V3h14z"/>'),
  };
})();
