/* Classes. VO v11 (≈ +0.4 → +4.2): "In the classroom, teachers set up each class, its look, and its syllabus."
   The educational side mirrors the layout: product left, headline right. */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const b = beat(tl, { id: 's10', at: T.s10, dur: T.s11 - T.s10, eyebrow: 'Educational space', lines: ['Every class,', '<span class="amb">ready.</span>'], sub: 'Its own look, its syllabus and its projects.', left: 1290, w: 540, diveAt: '700px 560px' });
  const T0 = b.T0;

  const weeks = [['Prelims', ['Systems and SDLC', 'Feasibility', 'Requirements', 'Interviews', 'Use cases', 'Prelim exam']], ['Midterms', ['Data flow', 'ERD', 'Data dictionary', 'UI design', 'Prototyping', 'Midterm exam']], ['Finals', ['Testing', 'Deployment', 'Documentation', 'Defense prep', 'Final defense', 'Final exam']]];
  const panel = prodPanel(b.stage, { cx: 680, cy: 550, w: 1040, h: 580, ry: 14, html: `
    <div style="padding:24px 28px 0">
      <div class="banner" style="padding:26px 30px"><div style="display:flex;align-items:center;gap:18px">
        <span class="mk" id="s10-mk" style="width:66px;height:66px;border-radius:18px;background:#26327a;border:2px solid rgba(255,255,255,.25)">${ic('cap', 32)}</span>
        <div><div class="eyebrow ey">Class · BSIT 3-A</div><h1 style="font-size:34px;margin-top:2px">Systems Analysis and Design</h1><p style="font-size:16px;margin-top:2px">38 students · 9 groups · 2 projects</p></div></div></div>
      <div class="tabs" style="margin-top:12px">${['Overview', 'Projects', 'Reports', 'Syllabus', 'Settings'].map((t) => `<div class="t ${t === 'Syllabus' ? 'on' : ''}" style="font-size:17px">${t}</div>`).join('')}</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:20px">${weeks.map((g, gi) => `<div><div class="fp-h" style="margin-bottom:8px">${g[0]}</div>${g[1].map((w, i) => `<div class="s10-w" style="display:flex;align-items:center;gap:10px;padding:8px 12px;margin-bottom:6px;border-radius:10px;background:var(--surface-sunken);border:1px solid var(--line)"><span class="mono" style="font-size:12.5px;color:var(--ink-faint);width:30px">W${gi * 6 + i + 1}</span><span style="font-size:15.5px;font-weight:600;white-space:nowrap">${w}</span></div>`).join('')}</div>`).join('')}</div>
    </div>` });
  gsap.set(panel, { scale: 1.04 });
  panelIn(tl, panel, T0 + 0.2, { x: -260 });

  // its look
  tl.to('#s10-mk', { backgroundColor: '#0a9a6a', duration: 0.35 }, T0 + 2.0);
  tl.to('#s10-mk', { scale: 1.22, duration: 0.17, yoyo: true, repeat: 1 }, T0 + 2.0);
  tl.to(panel.querySelector('.banner'), { '--banner': '#0f2a1d', '--banner2': '#1d5c3c', '--banner-accent': '#a3d977', '--banner-glow': '#a3d977', duration: 0.6 }, T0 + 2.05);
  // its syllabus, week by week
  tl.fromTo(panel.querySelectorAll('.s10-w'), { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: 0.3, ease: 'power2.out', stagger: 0.05 }, T0 + 1.2);
  sfx(T0 + 2.0, 'tick'); sfx(T0 + 1.2, 'pop');
});
