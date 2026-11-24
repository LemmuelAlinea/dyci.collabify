/* Shared helpers. No clocks, no randomness that is not seeded: every frame is a pure function of time. */
(function () {
  const W = window;
  W.ic = (n, s = 18, c = '') => `<svg class="ic ${c}" width="${s}" height="${s}" viewBox="0 0 24 24"><path d="${ICONS[n]}"/></svg>`;
  // a few glyphs the product's icon set does not carry
  ICONS.cap = 'M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 9v6';
  ICONS.brief = 'M3 8h18v12H3zM8 8V5a1 1 0 011-1h6a1 1 0 011 1v3M3 13h18';
  ICONS.wave = 'M3 12v0M7 8v8M11 4v16M15 8v8M19 10v4M21 12v0';
  ICONS.pdf = 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6';
  ICONS.stop = 'M6 6h12v12H6z';
  ICONS.send = 'M22 2L11 13M22 2l-7 20-4-9-9-4z';
  ICONS.branch = 'M6 3v12M18 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM18 9a9 9 0 01-9 9';
  ICONS.commit = 'M12 15a3 3 0 100-6 3 3 0 000 6zM3 12h6M15 12h6';
  ICONS.grad = ICONS.cap;

  W.EV = []; W.sfx = (t, n, d) => W.EV.push([t, n, d]);
  const HUES = { a: '#e0568b', b: '#3d8bd9', c: '#27a37a', d: '#8a5cf5', e: '#e8903a', f: '#17a6b8' };
  W.av = (ini, h = 'a', s = 34, cls = '') => `<span class="av ${cls}" style="width:${s}px;height:${s}px;background:${HUES[h] || h};font-size:${Math.round(s * 0.36)}px">${ini}</span>`;
  W.HUES = HUES;
  W.stack = (arr, s = 34) => `<span style="display:inline-flex">${arr.map((a, i) => av(a[0], a[1], s, '').replace('<span class="av "', `<span class="av" data-i="${i}"`).replace('style="', `style="${i ? 'margin-left:-' + Math.round(s * 0.28) + 'px;' : ''}`)).join('')}</span>`;

  /* The window: sidebar + topbar + a content slot. mode: 'edu' | 'work'. */
  W.appWindow = function (o = {}) {
    const mode = o.mode || 'edu';
    const act = o.active || 'Home';
    const it = (icon, label, extra = '') => `<div class="it ${act === label ? 'on' : ''}">${ic(icon, 20)}<span>${label}</span>${extra}</div>`;
    const proj = (ini, label, on) => `<div class="it ${on ? 'on' : ''}"><span class="sq">${ini}</span><span style="font-size:14.5px">${label}</span></div>`;
    const eduNav = `
      <div class="sec">Classes</div>${proj('S', 'Systems Analysis and Design', false)}<div class="all">All classes →</div>
      ${it('users', 'Groups')}${it('board', 'Class projects')}
      <div class="sec">Projects</div>${proj('B', 'Barangay health portal', act === 'Barangay health portal')}${proj('C', 'Capstone proposal', false)}<div class="all">All projects →</div>`;
    const workNav = `
      <div class="sec">Spaces</div>${proj('L', 'Lakbay Studio', false)}${proj('M', 'Mabuhay Events', false)}<div class="all">All spaces →</div>
      <div class="sec">Projects</div>${proj('P', 'Public market app', act === 'Public market app')}${proj('F', 'Feasibility study', false)}<div class="all">All projects →</div>`;
    const sb = `<aside class="sb">
      <div class="logo"><img src="assets/img/collabify-logo-dark.png" alt=""/><b>Collabify</b></div>
      <div class="sec" style="padding-top:6px">Main</div>
      ${it('board', 'Home')}${it('check', 'My tasks')}${it('calendar', 'Calendar')}${it('mail', 'Inbox', o.badge ? `<span class="badge" style="margin-left:auto">${o.badge}</span>` : '')}
      ${mode === 'edu' ? eduNav : workNav}
    </aside>`;
    return `<div class="win ${o.dark ? '' : 'theme-light'} ${o.cls || ''}">${sb}<div class="main"><div class="tb"><div class="search">${ic('search', 17)}Search Collabify</div><div class="me">${ic('bell', 20)}${ic(o.dark === false ? 'moon' : 'sun', 20, 'themeic')}<span style="display:flex;align-items:center;gap:10px;color:var(--ink)">${av(o.me || 'AS', 'a', 32)}${o.name || 'Angelica'}${ic('chevronDown', 16)}</span></div></div>${o.content || ''}</div></div>`;
  };

  W.banner = (o) => `<div class="banner ${o.cls || ''}"><div class="glow"></div><div class="grid"></div>
    ${o.tag ? `<div class="eyebrow ey">${o.tag}</div>` : ''}<h1>${o.title}</h1><p>${o.sub || ''}</p>
    ${o.acts ? `<div class="acts">${o.acts.map((a) => `<span class="sq-btn">${ic(a, 18)}</span>`).join('')}</div>` : ''}${o.extra || ''}</div>`;

  W.tabs = (list, on) => `<div class="tabs">${list.map((t) => `<div class="t ${t[1] === on ? 'on' : ''}">${ic(t[0], 18)}${t[1]}${t[2] != null ? `<span class="cnt">${t[2]}</span>` : ''}</div>`).join('')}</div>`;

  W.el = (html, parent) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const n = t.content.firstElementChild; if (parent) parent.appendChild(n); return n; };

  /* Split text into per-character spans for a deterministic typewriter. */
  W.chars = function (node, text) {
    node.textContent = '';
    const out = [];
    for (const ch of text) { const s = document.createElement('span'); s.textContent = ch; s.style.opacity = 0; node.appendChild(s); out.push(s); }
    return out;
  };
  W.type = (tl, node, text, at, cps = 42) => {
    const sp = chars(node, text);
    tl.to(sp, { opacity: 1, duration: 0.001, stagger: 1 / cps }, at);
    W.EV.push([at, 'type', sp.length / cps]);
    return sp.length / cps;
  };

  /* Words, for headlines that rise in by the word under a mask. */
  W.words = function (node, text, cls = '') {
    node.innerHTML = text.split(' ').map((w) => `<span class="wm" style="display:inline-block;overflow:hidden;vertical-align:top;padding:0 .04em .12em"><span class="wi ${cls}" style="display:inline-block">${w}</span></span>`).join(' ');
    return node.querySelectorAll('.wi');
  };

  /* A cursor that rides inside a host element, so it shares the host's 3D transform. */
  W.cursor = function (host, x0, y0) {
    const c = el(`<div class="cur" style="left:0;top:0"><svg viewBox="0 0 24 24"><path d="M4 2l15 8.6-6.4 1.7L9.5 19z" fill="#fff" stroke="#0a0f2c" stroke-width="1.6" stroke-linejoin="round"/></svg></div>`, host);
    gsap.set(c, { x: x0, y: y0 });
    return {
      el: c,
      to(tl, x, y, at, d = 0.7, ease = 'power3.inOut') { tl.to(c, { x, y, duration: d, ease }, at); return this; },
      click(tl, at, x, y) {
        W.EV.push([at, 'click']);
        const r = el(`<div class="rip"></div>`, host);
        tl.fromTo(c, { scale: 1 }, { scale: 0.82, duration: 0.07, yoyo: true, repeat: 1, ease: 'power2.out', transformOrigin: '8% 8%', immediateRender: false }, at);
        tl.fromTo(r, { x, y, scale: 0.4, opacity: 0.95 }, { scale: 3.2, opacity: 0, duration: 0.55, ease: 'power2.out', immediateRender: false }, at);
        return this;
      },
    };
  };

  /* a scene's rig: .fade (opacity lives here, never on the 3D camera) > .cam */
  W.rig = (root) => { const fade = el(`<div class="fade"></div>`, root); const cam = el(`<div class="cam"></div>`, fade); return { fade, cam }; };

  /* screen-space callouts that float in front of the camera (never pan with it) */
  W.hud = (fade) => el(`<div class="hud" style="position:absolute;inset:0;transform-style:preserve-3d;pointer-events:none"></div>`, fade);
  W.callout = (host, o) => {
    const ac = o.accent || '#f0b429';
    const n = el(`<div class="sat co" style="${o.right ? 'right' : 'left'}:${o.x}px;top:${o.y}px;width:${o.w || 390}px;padding:20px 24px;display:flex;gap:18px;align-items:center;border-color:${ac}66;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 60px ${ac}33,inset 0 1px 0 rgba(255,255,255,.14)">
      <span style="flex:none;width:58px;height:58px;border-radius:17px;background:${ac};color:#101637;display:grid;place-items:center">${ic(o.icon, 28)}</span>
      <div><div class="mono" style="font-size:12px;letter-spacing:.18em;color:${ac};text-transform:uppercase">${o.eyebrow}</div>
      <div class="disp" style="font-size:28px;font-weight:700;letter-spacing:-.025em;line-height:1.08;margin-top:5px;color:#fff">${o.title}</div>
      ${o.sub ? `<div style="font-size:15px;color:#b9c0dd;margin-top:4px;line-height:1.35">${o.sub}</div>` : ''}</div></div>`, host);
    gsap.set(n, { opacity: 0, z: o.z == null ? 140 : o.z, rotateY: o.right ? -9 : 9 });
    return n;
  };
  W.popIn = (tl, n, at, o = {}) => (W.EV.push([at, 'pop']), tl).fromTo(n, { opacity: 0, scale: 0.6, y: 36, rotateX: -35 }, Object.assign({ opacity: 1, scale: 1, y: 0, rotateX: 0, duration: 0.65, ease: 'back.out(1.5)', immediateRender: false }, o), at);
  W.popOut = (tl, n, at, o = {}) => tl.to(n, Object.assign({ opacity: 0, y: -24, scale: 0.92, duration: 0.3, ease: 'power2.in' }, o), at);

  /* centre of a node in a host's own layout px (ignores transforms, so it is safe at build time) */
  W.posIn = (n, host) => { let x = 0, y = 0, e = n; while (e && e !== host) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; } return { x: x + n.offsetWidth / 2, y: y + n.offsetHeight / 2, w: n.offsetWidth, h: n.offsetHeight, left: x, top: y }; };

  /* seeded rng, for placement that must look random but never change */
  W.rng = function (seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

  /* Fly the camera: animates a scene's .cam to a pose. */
  W.pose = (tl, cam, p, at, d, ease = 'power3.inOut') => tl.to(cam, Object.assign({ duration: d, ease }, p), at);
})();
