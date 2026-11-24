/* Work spaces. VO v04 (+0.4 → +6.9): "Start with a work space. Every project your team runs lives here,
   with its own look, overview, and reports." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const proj = [
    ['P', '#3d8bd9', 'Public market app', 'Build', 64, 'prog', [['AS', 'a'], ['MR', 'b'], ['JC', 'c']]],
    ['T', '#e0568b', 'Tourism booking site', 'Testing', 82, 'prog', [['RD', 'd'], ['BL', 'e']]],
    ['F', '#27a37a', 'Feasibility study', 'Done', 100, 'done', [['CM', 'f'], ['PG', 'b']]],
    ['B', '#e8903a', 'Brand refresh', 'Design', 28, 'pend', [['JC', 'c'], ['AS', 'a'], ['BL', 'e']]],
  ];
  const card = (p) => `<div class="card s3-card" style="padding:24px 26px;box-shadow:var(--shadow-card)">
      <div style="display:flex;align-items:center;gap:16px"><span class="mk s3-mk" style="background:${p[1]};width:56px;height:56px">${p[0]}</span>
        <div style="flex:1"><div style="font-size:21px;font-weight:700">${p[2]}</div><div style="font-size:14.5px;color:var(--ink-faint);margin-top:2px">Stage · ${p[3]}</div></div>${stack(p[6], 34)}</div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:22px"><div class="pbar" style="flex:1;height:10px"><i class="s3-bar" data-w="${p[4]}" style="width:0"></i></div><span class="mono" style="font-size:14px;color:var(--ink-muted)">${p[4]}%</span>${chip(p[5] === 'done' ? 'Done' : p[5] === 'prog' ? 'In progress' : 'Not started', p[5])}</div></div>`;
  const sw = ['#7048e8', '#e0568b', '#0f6f7c', '#e8903a', '#2fd18f', '#3d8bd9'];
  const content = `
    <div class="banner" id="s3-ban" style="padding:30px 34px;margin-top:4px"><div style="display:flex;align-items:center;gap:20px">
      <span class="mk" id="s3-space" style="width:70px;height:70px;border-radius:20px;font-size:30px;background:#26327a;border:2px solid rgba(255,255,255,.25)">L</span>
      <div><div class="eyebrow ey">Work space</div><h1 style="font-size:38px;margin-top:2px">Lakbay Studio</h1><p style="font-size:16px;margin-top:2px">4 projects · 12 members</p></div></div></div>
    <div id="s3-tabs">${tabs([['board', 'Overview'], ['kanban', 'Projects', 4], ['chart', 'Reports'], ['settings', 'Settings']], 'Projects')}</div>
    <div style="position:relative;margin-top:26px">
      <div id="s3-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:22px">${proj.map(card).join('')}</div>
      <div id="s3-ov" style="position:absolute;left:0;right:0;top:0;display:grid;grid-template-columns:repeat(4,1fr);gap:18px">${[['4', 'Projects'], ['37', 'Open tasks'], ['9', 'Done this week'], ['2', 'Need attention']].map((s) => `<div class="card" style="padding:22px"><div class="disp" style="font-size:44px;font-weight:800">${s[0]}</div><div style="color:var(--ink-muted);font-size:15px">${s[1]}</div></div>`).join('')}</div>
      <div id="s3-rp" style="position:absolute;left:0;right:0;top:0"><div class="card" style="padding:24px;height:300px;display:flex;align-items:flex-end;gap:22px">${[40, 62, 55, 78, 70, 88, 64, 92].map((v) => `<i style="display:block;flex:1;height:${v}%;border-radius:10px 10px 0 0;background:var(--navy-500)"></i>`).join('')}</div></div>
    </div>`;
  const cut = shot(tl, { id: 's03', at: T.s03, dur: T.s04 - T.s03, eyebrow: 'Work spaces', lines: ['One space for', 'every <span class="amb">project.</span>'], hold: 1.5, tag: 'Work spaces', world: appWindow({ mode: 'work', active: 'Home', content }) });
  const T0 = cut.T0, w = cut.world, q = (s) => w.querySelector(s);
  const cards = w.querySelectorAll('.s3-card'), tabsEl = w.querySelectorAll('#s3-tabs .t');
  gsap.set(cards, { opacity: 0, y: 30 }); gsap.set(['#s3-ov', '#s3-rp'], { opacity: 0 });
  const cur = cut.pointer();

  // the space, then its projects arriving
  cut.lookAt(q('#s3-ban'), T0 + 1.5, 0.7, { pad: 40 });
  cut.lookAt(q('#s3-grid'), T0 + 2.2, 0.9, { pad: 30 });
  tl.to(cards, { opacity: 1, y: 0, duration: 0.55, ease: 'back.out(1.4)', stagger: 0.12 }, T0 + 2.3);
  w.querySelectorAll('.s3-bar').forEach((n, i) => tl.to(n, { width: n.dataset.w + '%', duration: 1.0, ease: 'power3.out' }, T0 + 2.7 + i * 0.1));
  // its own look: in on the first project's mark, pick a color and an icon
  const mk = w.querySelectorAll('.s3-mk')[0], mr = cut.rect(mk, 0);
  const look = el(`<div style="position:absolute;left:${mr.x}px;top:${mr.y + mr.h + 12}px;padding:16px;border-radius:16px;background:var(--surface);border:1px solid var(--line-strong);box-shadow:var(--shadow-lift);z-index:20" class="theme-light">
      <div class="eyebrow" style="color:var(--ink-faint);margin-bottom:10px">Color and icon</div>
      <div style="display:flex;gap:10px">${sw.map((c, i) => `<i class="s3-sw" style="display:block;width:34px;height:34px;border-radius:50%;background:${c};box-shadow:0 0 0 1px var(--line-strong)"></i>`).join('')}</div>
      <div style="display:flex;gap:10px;margin-top:12px;color:var(--ink-muted)">${['brief', 'kanban', 'target', 'spark', 'folder', 'users'].map((n) => `<span class="s3-ic" style="width:34px;height:34px;border-radius:9px;border:1px solid var(--line);display:grid;place-items:center">${ic(n, 18)}</span>`).join('')}</div></div>`, w);
  gsap.set(look, { opacity: 0 });
  cut.lookAt(cards[0], T0 + 3.75, 0.65, { pad: 30 });
  cur.show(T0 + 3.85).tap(mk, T0 + 4.35, 0.35);
  tl.fromTo(look, { opacity: 0, y: -8, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.25, ease: 'back.out(1.6)', immediateRender: false }, T0 + 4.4);
  cut.look({ x: mr.x - 40, y: mr.y - 40, w: 640, h: 320 }, T0 + 4.4, 0.45);
  cur.tap(w.querySelectorAll('.s3-sw')[0], T0 + 4.85, 0.3);
  tl.to(mk, { backgroundColor: '#7048e8', duration: 0.25 }, T0 + 4.9);
  cur.tap(w.querySelectorAll('.s3-ic')[3], T0 + 5.2, 0.25);
  tl.set(mk, { innerHTML: ic('spark', 26) }, T0 + 5.25);
  tl.to(look, { opacity: 0, duration: 0.2 }, T0 + 5.4);
  cur.hide(T0 + 5.45);
  // overview, then reports
  const tabOn = (i, at) => tabsEl.forEach((t, j) => tl.set(t, { attr: { class: 't' + (i === j ? ' on' : '') } }, at));
  const t0r = cut.rect(tabsEl[0]);
  cut.look({ x: t0r.x - 20, y: t0r.y - 40, w: 1100, h: 560 }, T0 + 5.45, 0.55);
  tabOn(0, T0 + 5.7); tl.to('#s3-grid', { opacity: 0, duration: 0.15 }, T0 + 5.7); tl.to('#s3-ov', { opacity: 1, duration: 0.2 }, T0 + 5.75);
  tabOn(2, T0 + 6.4); tl.to('#s3-ov', { opacity: 0, duration: 0.15 }, T0 + 6.4); tl.to('#s3-rp', { opacity: 1, duration: 0.2 }, T0 + 6.45);
  tl.fromTo(w.querySelectorAll('#s3-rp i'), { scaleY: 0, transformOrigin: '50% 100%' }, { scaleY: 1, duration: 0.5, stagger: 0.04, ease: 'power3.out', immediateRender: false }, T0 + 6.45);
  cut.look(cut.full, T0 + 7.0, 0.9, { fill: 1 });
  sfx(T0 + 2.3, 'pop'); sfx(T0 + 6.45, 'rise');
});
