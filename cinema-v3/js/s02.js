/* Make it yours (ported from the October film, retimed to T.s02).
   VO v03 "Make it yours. Pick every color, from your banners to your status highlights. Light, or dark." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const T = window.T.s02, K = 1.12;
  const root = document.getElementById('s02');
  const { fade, cam } = rig(root);
  const scope = el(`<div id="w2-scope" class="p3" style="left:0;top:0;width:1920px;height:1080px"></div>`, cam);

  /* ----- the preview: the real Home, twice (dark, then light) ----- */
  const prevWrap = el(`<div id="w2-prev" class="p3" style="left:0;top:0;width:1920px;height:1080px"></div>`, scope);
  const mk = (cls) => { const w = el(appWindow({ mode: 'edu', active: 'Home', content: S.home(), cls, dark: !cls }), prevWrap); w.style.left = (1350 - 960) + 'px'; w.style.top = (520 - 540) + 'px'; gsap.set(w, { scale: 0.56, transformOrigin: '50% 50%' }); return w; };
  const winD = mk('');
  const winL = mk('theme-light');
  gsap.set(winL, { clipPath: 'circle(0px at 1700px 40px)' });
  gsap.set(prevWrap, { z: -140, rotateY: -14, rotateX: 3, transformOrigin: '1350px 520px' });

  /* ----- the editor: Settings → Appearance → Your colors ----- */
  const sw = (v, w = 34) => `<span style="display:inline-block;flex:none;width:${w}px;height:${w}px;border-radius:50%;background:var(${v});border:2px solid rgba(255,255,255,.35)"></span>`;
  const preset = (id, name, note, dots) => `<div id="pr-${id}" style="position:relative;padding:14px 16px;border:1px solid var(--line-strong);border-radius:14px;background:var(--surface-sunken)">
      <div style="display:flex;gap:6px;margin-bottom:10px">${dots.map((d) => `<i style="display:block;width:26px;height:26px;border-radius:50%;background:${d};border:2px solid rgba(255,255,255,.25)"></i>`).join('')}</div>
      <div style="font-weight:700;font-size:16px">${name}</div><div style="font-size:12.5px;color:var(--ink-muted);margin-top:2px;line-height:1.35">${note}</div>
      <div class="sel" style="position:absolute;inset:-2px;border:2px solid var(--amber-300);border-radius:15px;opacity:0;box-shadow:0 0 30px rgba(247,199,74,.35)"></div></div>`;
  const row = (lab, v, pill) => `<div style="display:flex;align-items:center;gap:14px;padding:10px 0;border-top:1px solid var(--line)">${sw(v, 30)}<div style="flex:1;font-size:15.5px;font-weight:600">${lab}</div>${pill}</div>`;
  const fieldBox = (label, note, v, id = '') => `<div ${id ? `id="${id}"` : ''} style="display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--line);border-radius:12px">${sw(v)}<div><div style="font-weight:600;font-size:15px">${label}</div><div style="font-size:12px;color:var(--ink-faint)">${note}</div></div></div>`;
  const editor = el(`<div id="w2-ed" class="p3 win" style="left:0;top:0;width:880px;height:auto;display:block;padding:30px 34px 34px;border-radius:26px;background:var(--surface);overflow:visible">
      <div style="display:flex;align-items:center;gap:12px"><span class="tile" style="width:46px;height:46px">${ic('palette', 22)}</span><div><h2 style="font-size:30px;line-height:1">Your colors</h2><div style="font-size:14px;color:var(--ink-muted);margin-top:4px">Changes apply as you make them.</div></div>
        <span id="w2-saved" class="pill done" style="margin-left:auto;opacity:0">${ic('check', 14)}Saved</span>
        <div style="display:flex;border:1px solid var(--line-strong);border-radius:11px;overflow:hidden;font-size:14px;font-weight:600"><span id="w2-mL" style="padding:8px 16px;color:var(--ink-muted)">Light</span><span id="w2-mD" style="padding:8px 16px;background:var(--surface-raised)">Dark</span></div></div>
      <div class="eyebrow" style="color:var(--ink-faint);margin:26px 0 10px">Start from</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
        ${preset('def', 'Collabify default', 'Navy banners, green for done, amber for in progress.', ['#080b21', '#f0b429', '#2fd18f', '#ff6b6b'])}
        ${preset('forest', 'Forest', 'Deep green banners with a leaf accent.', ['#0f2a1d', '#a3d977', '#51cf66', '#ff6b3d'])}
        ${preset('ocean', 'Ocean', 'Sea-blue gradient banners, progress in blue.', ['#0b2540', '#5ec8e5', '#20c997', '#fab005'])}
      </div>
      <div class="eyebrow" style="color:var(--ink-faint);margin:26px 0 8px">Page banners</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
        ${fieldBox('Background', 'The banner color', '--banner', 'w2-f-ban')}${fieldBox('Right color', 'Where the gradient ends', '--banner2')}${fieldBox('Accent', 'Highlights and glow', '--banner-accent')}
      </div>
      <div class="eyebrow" style="color:var(--ink-faint);margin:24px 0 2px">Status highlights</div>
      <div id="w2-status">
        ${row('Done', '--st-done', '<span class="pill done">Done</span>')}
        ${row('In progress', '--st-prog', '<span class="pill prog">In progress</span>')}
        ${row('Late', '--st-late', '<span class="pill late">Late</span>')}
        ${row('Pending', '--st-pend', '<span class="pill pend">Pending</span>')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px">
        ${[['Sidebar', '--nav-active'], ['Progress', '--progress'], ['Badges', '--badge'], ['Icons', '--icon-glyph']].map((a) => `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:12px">${sw(a[1], 26)}<span style="font-size:13.5px;font-weight:600">${a[0]}</span></div>`).join('')}
      </div>
      <!-- the swatch popover -->
      <div id="w2-pop" data-layout-ignore style="position:absolute;left:34px;top:392px;width:430px;padding:16px;border-radius:18px;background:var(--surface-raised);border:1px solid var(--line-strong);box-shadow:var(--shadow-lift);opacity:0">
        <div class="eyebrow" style="color:var(--ink-faint);margin-bottom:10px">Pick a color</div>
        <div style="display:grid;grid-template-columns:repeat(9,1fr);gap:9px">${['#080b21', '#26327a', '#0b2540', '#0f2a1d', '#3b0a2a', '#000000', '#00bc7d', '#2f9e44', '#0072b2', '#1c7ed6', '#7048e8', '#e64980', '#fb2c36', '#d55e00', '#f0b429', '#ffd43b', '#59627f', '#ffffff'].map((c, i) => `<i ${i === 4 ? 'id="w2-pick"' : ''} style="display:block;aspect-ratio:1;border-radius:50%;background:${c};border:2px solid rgba(255,255,255,.3)"></i>`).join('')}</div></div>
    </div>`, scope);
  editor.style.left = (470 - 440) + 'px'; editor.style.top = (560 - 380) + 'px';
  gsap.set(editor, { scale: 0.78, transformOrigin: '50% 50%', rotateY: 11, rotateX: 2, z: 60 });
  const cur = cursor(editor, 520, 840);

  /* hero type, behind everything */
  const hero = el(`<div class="p3" style="left:0;top:50px;width:1920px;text-align:center"><div class="h-xl" style="font-size:118px"><div style="overflow:hidden;padding-bottom:.24em;margin-bottom:-.12em;display:block"><span class="hs" style="display:block">Your workspace.</span></div><div style="overflow:hidden;padding-bottom:.24em;margin-bottom:-.12em;display:block"><span class="hs amb" style="display:block">Your colors.</span></div></div></div>`, cam);
  gsap.set(hero, { z: -260, opacity: 0 });
  const hs = hero.querySelectorAll('.hs');

  const P = {
    def: { '--banner': '#080b21', '--banner2': '#080b21', '--banner-accent': '#f7c74a', '--banner-glow': '#f0b429', '--nav-marker': '#f0b429', '--nav-icon': '#f7c74a', '--progress': '#10b981', '--badge': '#f0b429', '--icon-tile': '#080b21', '--icon-glyph': '#f7c74a', '--st-done': '#2fd18f', '--st-prog': '#f0b429', '--st-late': '#ff6b6b', '--nav-active': '#f0b429', '--banner-edge': '#3d4da3', '--btn-create': '#f0b429' },
    forest: { '--banner': '#0f2a1d', '--banner2': '#0f2a1d', '--banner-accent': '#a3d977', '--banner-glow': '#a3d977', '--nav-marker': '#a3d977', '--nav-icon': '#a3d977', '--progress': '#51cf66', '--badge': '#a3d977', '--icon-tile': '#0f2a1d', '--icon-glyph': '#a3d977', '--st-done': '#51cf66', '--st-prog': '#e8a33d', '--st-late': '#ff6b3d', '--nav-active': '#a3d977', '--banner-edge': '#2f6b3f', '--btn-create': '#a3d977' },
    ocean: { '--banner': '#0b2540', '--banner2': '#1c5d99', '--banner-accent': '#5ec8e5', '--banner-glow': '#5ec8e5', '--nav-marker': '#5ec8e5', '--nav-icon': '#5ec8e5', '--progress': '#4dabf7', '--badge': '#5ec8e5', '--icon-tile': '#0b2540', '--icon-glyph': '#5ec8e5', '--st-done': '#20c997', '--st-prog': '#fab005', '--st-late': '#ff6b6b', '--nav-active': '#5ec8e5', '--banner-edge': '#1c5d99', '--btn-create': '#5ec8e5' },
    rose: { '--banner': '#3b0a2a', '--banner2': '#7048e8', '--banner-accent': '#ffd43b', '--banner-glow': '#e64980', '--nav-marker': '#e64980', '--nav-icon': '#ff8fb3', '--progress': '#e64980', '--badge': '#ffd43b', '--icon-tile': '#3b0a2a', '--icon-glyph': '#ffd43b', '--st-done': '#38d9a9', '--st-prog': '#ffd43b', '--st-late': '#ff5d8f', '--nav-active': '#e64980', '--banner-edge': '#7048e8', '--btn-create': '#ffd43b' },
    roseL: { '--nav-icon': '#a61e4d', '--nav-active': '#a61e4d' },
  };
  const paint = (at, p, d = 0.9, tgt = scope) => tl.to(tgt, Object.assign({ duration: d, ease: 'power2.inOut' }, p), at);
  const sel = (id, at, on) => tl.to(`#pr-${id} .sel`, { opacity: on ? 1 : 0, duration: 0.25 }, at);

  /* ===== timeline ===== */
  tl.fromTo(cam, { scale: 2.6, transformOrigin: '960px 540px' }, { scale: 1, duration: 1.0, ease: 'expo.out' }, T);
  tl.fromTo(fade, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power1.out' }, T);
  tl.fromTo(editor, { x: -260, opacity: 0 }, { x: 0, opacity: 1, duration: 1.0, ease: 'expo.out' }, T + K * 0.3);
  tl.fromTo(prevWrap, { x: 300, opacity: 0 }, { x: 0, opacity: 1, duration: 1.1, ease: 'expo.out' }, T + K * 0.45);
  tl.fromTo(cam, { rotateY: -5 }, { rotateY: 4, duration: 7.4, ease: 'sine.inOut', immediateRender: false }, T + K * 0.3);

  // Forest
  cur.to(tl, 439, 200, T + K * 1.3, 0.9);
  cur.click(tl, T + K * 2.2, 439, 200);
  sel('forest', T + K * 2.2, true);
  paint(T + K * 2.25, P.forest, 1.0);
  tl.fromTo('#w2-saved', { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3, immediateRender: false }, T + K * 3.1);
  // Ocean
  cur.to(tl, 713, 200, T + K * 3.5, 0.7);
  cur.click(tl, T + K * 4.2, 713, 200);
  sel('forest', T + K * 4.2, false); sel('ocean', T + K * 4.2, true);
  paint(T + K * 4.25, P.ocean, 1.0);
  // their own colors, from the swatch popover
  cur.to(tl, 165, 346, T + K * 4.9, 0.7);
  cur.click(tl, T + K * 5.2, 165, 346);
  tl.fromTo('#w2-pop', { opacity: 0, y: 14, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: 'back.out(1.6)', immediateRender: false }, T + K * 5.25);
  sel('ocean', T + K * 5.65, false);
  cur.to(tl, 122, 468, T + K * 5.5, 0.55);
  cur.click(tl, T + K * 6.05, 122, 468);
  paint(T + K * 6.1, P.rose, 1.0);
  tl.to('#w2-pop', { opacity: 0, y: 10, duration: 0.25 }, T + K * 6.55);
  tl.fromTo('#w2-status .pill', { scale: 1 }, { scale: 1.14, duration: 0.18, yoyo: true, repeat: 1, stagger: 0.1, immediateRender: false }, T + K * 6.65);

  // light mode, iris out of the sun icon
  tl.to(winL, { clipPath: 'circle(2400px at 1700px 40px)', duration: 1.0, ease: 'power2.inOut' }, T + K * 6.85);
  paint(T + K * 6.85, P.roseL, 0.8, winL);
  tl.set('#w2-mL', { background: 'var(--surface-raised)', color: 'var(--ink)' }, T + K * 7.05);
  tl.set('#w2-mD', { background: 'transparent', color: 'var(--ink-muted)' }, T + K * 7.05);

  // finale: preview comes forward, headline rises behind
  tl.to(editor, { x: -560, opacity: 0, duration: 0.7, ease: 'power3.in' }, T + K * 7.0);
  tl.to(prevWrap, { x: -390, y: 215, scale: 1.04, rotateY: -6, rotateX: 2, z: 60, duration: 1.0, ease: 'expo.inOut' }, T + K * 6.95);
  tl.to(hero, { opacity: 1, duration: 0.01 }, T + K * 6.95);
  tl.fromTo(hs, { yPercent: 110 }, { yPercent: 0, duration: 0.8, ease: 'expo.out', stagger: 0.14, immediateRender: false }, T + K * 7.15);
  tl.to(cam, { transformOrigin: '960px 700px', scale: 2.4, duration: 0.6, ease: 'expo.in' }, T + K * 7.65);
  tl.to(fade, { opacity: 0, duration: 0.45, ease: 'power2.in' }, T + K * 7.75);
});
