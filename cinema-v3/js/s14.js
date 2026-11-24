/* Analytics and reports. VO v15 (+0.4 → +4.0): "And analytics show who needs help, with reports ready to export." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const flags = [['Group 4', 'No activity in 9 days', 'late'], ['Carlo M.', '3 tasks past due', 'late'], ['Group 2', 'Milestone 2 at risk', 'prog']];
  const bars = [62, 78, 45, 88, 30, 71, 66, 54, 80];
  const content = `
    <div class="banner" style="padding:24px 30px;margin-top:4px"><div class="eyebrow ey">Class · BSIT 3-A</div><h1 style="font-size:32px;margin-top:2px">Systems Analysis and Design</h1></div>
    <div style="display:flex;align-items:flex-end;gap:12px">${tabs([['board', 'Overview'], ['kanban', 'Projects'], ['chart', 'Reports'], ['calendar', 'Syllabus'], ['settings', 'Settings']], 'Reports')}<span style="flex:1"></span><span class="btn" id="s14-exp" style="margin-bottom:6px">${ic('download', 17)}Export</span></div>
    <div id="s14-att" style="margin-top:22px"><div class="fp-h" style="margin-bottom:12px">Needs attention</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">${flags.map((f) => `<div class="s14-f" style="padding:20px 22px;border-radius:16px;border:1px solid color-mix(in oklab,var(--st-${f[2]}) 45%,transparent);background:color-mix(in oklab,var(--st-${f[2]}) 9%,var(--surface))"><div style="display:flex;align-items:center;gap:10px;color:var(--st-${f[2]})">${ic('alert', 20)}<b style="font-size:19px;color:var(--ink)">${f[0]}</b></div><div style="font-size:16px;color:var(--ink-muted);margin-top:6px">${f[1]}</div></div>`).join('')}</div></div>
    <div id="s14-chart" class="card" style="margin-top:22px;padding:22px"><div class="fp-h" style="margin-bottom:12px">Progress by group</div>
      <div style="display:flex;align-items:flex-end;gap:20px;height:300px">${bars.map((v, i) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:8px;height:100%;justify-content:flex-end"><i class="s14-b" data-h="${v}" style="display:block;width:100%;height:0;border-radius:10px 10px 0 0;background:${v < 50 ? 'var(--st-late)' : 'var(--navy-500)'}"></i><span class="mono" style="font-size:13px;color:var(--ink-faint)">G${i + 1}</span></div>`).join('')}</div></div>`;
  const cut = shot(tl, { id: 's14', at: T.s14, dur: T.s15 - T.s14, eyebrow: 'Analytics and reports', lines: ['See who', 'needs <span class="amb">help.</span>'], hold: 1.0, tag: 'Analytics and reports', world: appWindow({ mode: 'edu', active: 'Home', content }) });
  const T0 = cut.T0, w = cut.world, q = (s) => w.querySelector(s), all = (s) => [...w.querySelectorAll(s)];
  const fl = all('.s14-f');
  gsap.set(fl, { opacity: 0, y: 16 });
  const cur = cut.pointer();
  const er = cut.rect(q('#s14-exp'), 0);
  const menu = el(`<div class="theme-light" style="position:absolute;left:${er.x + er.w - 260}px;top:${er.y + er.h + 8}px;width:260px;padding:8px;border-radius:16px;background:var(--surface);border:1px solid var(--line-strong);box-shadow:var(--shadow-lift);z-index:20">${[['Excel', '#0a9a6a'], ['Word', '#1c5d99'], ['Print or PDF', '#e03a40'], ['CSV', '#59627f']].map((o) => `<div class="s14-o" style="display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:10px;font-size:17px;font-weight:600"><span style="width:30px;height:30px;border-radius:8px;background:${o[1]};color:#fff;display:grid;place-items:center">${ic('file', 16)}</span>${o[0]}</div>`).join('')}</div>`, w);
  gsap.set(menu, { opacity: 0 });

  // who needs help
  cut.lookAt(q('#s14-att'), T0 + 1.0, 0.6, { pad: 40 });
  tl.to(fl, { opacity: 1, y: 0, duration: 0.4, ease: 'back.out(1.6)', stagger: 0.15 }, T0 + 1.15);
  fl.forEach((f, i) => tl.fromTo(f, { boxShadow: '0 0 0 0 rgba(242,73,79,.45)' }, { boxShadow: '0 0 0 12px rgba(242,73,79,0)', duration: 0.6, immediateRender: false }, T0 + 1.5 + i * 0.15));
  cut.look({ x: cut.rect(q('#s14-att'), 0).x - 30, y: cut.rect(q('#s14-att'), 0).y - 30, w: 1600, h: 640 }, T0 + 1.9, 0.6);
  all('.s14-b').forEach((n, i) => tl.to(n, { height: n.dataset.h + '%', duration: 0.6, ease: 'power3.out' }, T0 + 2.0 + i * 0.04));
  // export
  cut.look({ x: er.x - 500, y: er.y - 60, w: 800, h: 420 }, T0 + 2.6, 0.5);
  cur.show(T0 + 2.6).tap(q('#s14-exp'), T0 + 3.05, 0.4);
  tl.fromTo(menu, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.2, immediateRender: false }, T0 + 3.1);
  cur.tap(menu.querySelector('.s14-o'), T0 + 3.55, 0.3);
  tl.to(menu.querySelector('.s14-o'), { backgroundColor: 'var(--surface-sunken)', duration: 0.1 }, T0 + 3.45);
  tl.to(menu, { opacity: 0, duration: 0.2 }, T0 + 3.7);
  const toast = el(`<div class="toast" style="left:${er.x - 380}px;top:${er.y + 90}px;font-size:17px">${ic('download', 20)}Formal term record.xlsx</div>`, w);
  tl.fromTo(toast, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.3, ease: 'back.out(1.6)' }, T0 + 3.75);
  cur.hide(T0 + 4.1);
  cut.look(cut.full, T0 + 4.4, 1.0, { fill: 1 });
  sfx(T0 + 1.15, 'pop'); sfx(T0 + 3.75, 'ding');
});
