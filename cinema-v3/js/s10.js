/* Classes. VO v11 (+0.4 → +4.2): "In the classroom, teachers set up each class, its look, and its syllabus." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const terms = [['Prelims', ['Systems and SDLC', 'Feasibility', 'Requirements', 'Use cases']], ['Midterms', ['Data flow', 'ERD', 'UI design', 'Prototyping']], ['Finals', ['Testing', 'Deployment', 'Documentation', 'Final defense']]];
  const weeks = terms.flatMap((t, ti) => t[1].map((w, i) => [ti, i, w]));
  const LW = 1460, X0 = 60, gap = (LW - 120) / (weeks.length - 1);
  const sw = ['#0a9a6a', '#c2306a', '#2f6fb5', '#b05510', '#6a3fd6'];
  const content = `
    <div class="banner" id="s10-ban" style="padding:30px 34px;margin-top:4px"><div style="display:flex;align-items:center;gap:20px">
      <span class="mk" id="s10-mk" style="width:72px;height:72px;border-radius:20px;background:#26327a;border:2px solid rgba(255,255,255,.25)">${ic('cap', 34)}</span>
      <div><div class="eyebrow ey">Class · BSIT 3-A</div><h1 style="font-size:38px;margin-top:2px">Systems Analysis and Design</h1><p style="font-size:16px;margin-top:2px">38 students · 9 groups · 2 projects</p></div></div></div>
    ${tabs([['board', 'Overview'], ['kanban', 'Projects'], ['chart', 'Reports'], ['calendar', 'Syllabus'], ['settings', 'Settings']], 'Syllabus')}
    <div id="s10-map" class="card" style="margin-top:24px;padding:26px 0 30px">
      <div style="padding:0 30px"><h3 style="font-size:22px">Term map</h3><div style="font-size:14.5px;color:var(--ink-faint)">From the syllabus, week by week.</div></div>
      <div style="position:relative;height:250px;margin-top:30px">
        <div style="position:absolute;left:${X0}px;width:${LW - 120}px;top:62px;height:4px;border-radius:4px;background:var(--line-strong)"></div>
        <div id="s10-fill" style="position:absolute;left:${X0}px;width:0;top:62px;height:4px;border-radius:4px;background:linear-gradient(90deg,var(--navy-600),#f0b429)"></div>
        ${terms.map((t, ti) => `<div class="mono s10-term" style="position:absolute;left:${X0 + ti * 4 * gap - 10}px;top:0;font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-faint)">${t[0]}</div>`).join('')}
        ${weeks.map((w, k) => `<div class="stp s10-w" style="left:${X0 + k * gap}px;top:49px;width:110px;margin-left:-55px"><span class="dot"><i></i></span><b style="font-size:14px;white-space:normal;text-align:center;line-height:1.25">W${k + 1}<br><span style="font-weight:500;color:var(--ink-muted)">${w[2]}</span></b></div>`).join('')}
      </div>
    </div>`;
  const cut = shot(tl, { id: 's10', at: T.s10, dur: T.s11 - T.s10, eyebrow: 'Educational space', lines: ['Every class,', '<span class="amb">ready.</span>'], hold: 1.1, tag: 'Classes', world: appWindow({ mode: 'edu', active: 'Home', content }) });
  const T0 = cut.T0, w = cut.world, q = (s) => w.querySelector(s), all = (s) => [...w.querySelectorAll(s)];
  const ws = all('.s10-w');
  gsap.set(ws, { opacity: 0, y: 10 }); gsap.set(all('.s10-term'), { opacity: 0 });
  const cur = cut.pointer();
  const mk = q('#s10-mk'), mr = cut.rect(mk, 0);
  const look = el(`<div class="theme-light" style="position:absolute;left:${mr.x}px;top:${mr.y + mr.h + 12}px;padding:14px;border-radius:16px;background:var(--surface);border:1px solid var(--line-strong);box-shadow:var(--shadow-lift);z-index:20;display:flex;gap:10px">${sw.map((c) => `<i class="s10-sw" style="display:block;width:34px;height:34px;border-radius:50%;background:${c}"></i>`).join('')}</div>`, w);
  gsap.set(look, { opacity: 0 });

  // the class, then its look
  cut.lookAt(q('#s10-ban'), T0 + 1.1, 0.6, { pad: 40 });
  cut.look({ x: mr.x - 40, y: mr.y - 40, w: 700, h: 300 }, T0 + 1.75, 0.5);
  cur.show(T0 + 1.75).tap(mk, T0 + 2.2, 0.35);
  tl.fromTo(look, { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.2, immediateRender: false }, T0 + 2.25);
  cur.tap(all('.s10-sw')[0], T0 + 2.6, 0.25);
  tl.to(mk, { backgroundColor: '#0a9a6a', duration: 0.25 }, T0 + 2.62);
  tl.to(q('#s10-ban'), { '--banner': '#0f2a1d', '--banner2': '#1d5c3c', '--banner-accent': '#a3d977', '--banner-glow': '#a3d977', duration: 0.5 }, T0 + 2.65);
  tl.to(look, { opacity: 0, duration: 0.15 }, T0 + 2.85);
  cur.hide(T0 + 2.9);
  // its syllabus: the term map draws left to right
  cut.lookAt(q('#s10-map'), T0 + 2.95, 0.6, { pad: 20 });
  tl.to(all('.s10-term'), { opacity: 1, duration: 0.3, stagger: 0.4 }, T0 + 3.2);
  tl.to('#s10-fill', { width: LW - 120, duration: 1.8, ease: 'power1.inOut' }, T0 + 3.2);
  ws.forEach((n, i) => tl.to(n, { opacity: 1, y: 0, duration: 0.25, ease: 'back.out(2)' }, T0 + 3.2 + i * 0.15));
  cut.look(cut.full, T0 + 5.1, 0.9, { fill: 1 });
  sfx(T0 + 2.62, 'tick'); sfx(T0 + 3.2, 'rise');
});
