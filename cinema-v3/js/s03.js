/* Work spaces. VO v04 "Start with a work space. Every project your team runs lives here,
   with its own look, overview, and reports." (≈ +0.4 → +6.9) */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const b = beat(tl, { id: 's03', at: T.s03, dur: T.s04 - T.s03, eyebrow: 'Work spaces', lines: ['One space for', 'every <span class="amb">project.</span>'], sub: 'Your team’s projects, overview and reports, in one place.' });
  const T0 = b.T0;

  const proj = [
    ['P', '#3d8bd9', 'Public market app', 'Build', 64, 'prog', [['AS', 'a'], ['MR', 'b'], ['JC', 'c']]],
    ['T', '#e0568b', 'Tourism booking site', 'Testing', 82, 'prog', [['RD', 'd'], ['BL', 'e']]],
    ['F', '#27a37a', 'Feasibility study', 'Done', 100, 'done', [['CM', 'f'], ['PG', 'b']]],
    ['B', '#e8903a', 'Brand refresh', 'Design', 28, 'pend', [['JC', 'c'], ['AS', 'a'], ['BL', 'e']]],
  ];
  const card = (p, i) => `<div class="card s3-card" style="padding:22px 24px;box-shadow:var(--shadow-card)">
      <div style="display:flex;align-items:center;gap:14px"><span class="mk s3-mk" data-i="${i}" style="background:${p[1]}">${p[0]}</span>
        <div style="flex:1;min-width:0"><div style="font-size:20px;font-weight:700;line-height:1.2">${p[2]}</div><div style="font-size:14.5px;color:var(--ink-faint);margin-top:2px">Stage · ${p[3]}</div></div></div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:20px"><div class="pbar" style="flex:1;height:10px"><i class="s3-bar" data-w="${p[4]}" style="width:0"></i></div><span class="mono" style="font-size:14px;color:var(--ink-muted)">${p[4]}%</span></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:16px">${stack(p[6], 32)}${chip(p[5] === 'done' ? 'Done' : p[5] === 'prog' ? 'In progress' : 'Not started', p[5])}</div></div>`;

  const panel = prodPanel(b.stage, { cx: 1290, cy: 560, w: 1000, h: 640, html: `
    <div style="padding:26px 30px 0">
      <div class="banner" style="padding:28px 30px">
        <div style="display:flex;align-items:center;gap:18px"><span class="mk" id="s3-space" style="width:64px;height:64px;border-radius:18px;font-size:28px;background:#26327a;border:2px solid rgba(255,255,255,.25)">L</span>
          <div><div class="eyebrow ey">Work space</div><h1 style="font-size:36px;margin-top:2px">Lakbay Studio</h1><p style="font-size:16px;margin-top:2px">4 projects · 12 members</p></div></div>
      </div>
      <div class="tabs" id="s3-tabs" style="margin-top:14px">${['Overview', 'Projects', 'Reports', 'Settings'].map((t, i) => `<div class="t ${i === 1 ? 'on' : ''}" style="font-size:17px">${t}</div>`).join('')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:22px">${proj.map(card).join('')}</div>
    </div>` });
  gsap.set(panel, { scale: 1.12 });
  panelIn(tl, panel, T0 + 0.25);
  const cards = panel.querySelectorAll('.s3-card');
  tl.fromTo(cards, { opacity: 0, y: 30, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'back.out(1.4)', stagger: 0.12 }, T0 + 1.0);
  panel.querySelectorAll('.s3-bar').forEach((n, i) => tl.to(n, { width: n.dataset.w + '%', duration: 1.1, ease: 'power3.out' }, T0 + 1.5 + i * 0.12));

  // "its own look": the space mark and the first project's mark change color and icon
  const co = callout(b.hud, { x: 1210, y: 120, w: 420, icon: 'palette', eyebrow: 'Its own look', title: 'Color and icon', sub: 'For the space and every project' });
  tl.to(co, { opacity: 1, z: 140, duration: 0.5, ease: 'expo.out' }, T0 + 3.4);
  const mk = panel.querySelectorAll('.s3-mk')[0];
  tl.to(mk, { backgroundColor: '#7048e8', duration: 0.4, ease: 'power2.inOut' }, T0 + 3.8);
  tl.to(mk, { scale: 1.25, duration: 0.18, yoyo: true, repeat: 1 }, T0 + 3.8);
  tl.to('#s3-space', { backgroundColor: '#0f6f7c', duration: 0.4 }, T0 + 4.1);
  tl.to(co, { opacity: 0, duration: 0.3 }, T0 + 5.4);

  // overview, reports: the tab marker walks across as the voice names them
  const tabs = panel.querySelectorAll('#s3-tabs .t');
  const onTab = (i, at) => tabs.forEach((t, j) => tl.set(t, { attr: { class: 't' + (i === j ? ' on' : '') } }, at));
  onTab(0, T0 + 5.6); onTab(2, T0 + 6.3); onTab(1, T0 + 7.2);
  sfx(T0 + 1.0, 'pop'); sfx(T0 + 3.8, 'tick');
});
