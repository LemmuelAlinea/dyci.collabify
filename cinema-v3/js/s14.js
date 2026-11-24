/* Analytics and reports. VO v15 (≈ +0.4 → +4.0):
   "And analytics show who needs help, with reports ready to export." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const b = beat(tl, { id: 's14', at: T.s14, dur: T.s15 - T.s14, eyebrow: 'Analytics and reports', lines: ['See who', 'needs <span class="amb">help.</span>'], sub: 'Then export the report in one click.', left: 1290, w: 540, diveAt: '700px 560px' });
  const T0 = b.T0;

  const flags = [['Group 4', 'No activity in 9 days', 'late'], ['Carlo M.', '3 tasks past due', 'late'], ['Group 2', 'Milestone 2 at risk', 'prog']];
  const bars = [62, 78, 45, 88, 30, 71, 66, 54, 80];
  const panel = prodPanel(b.stage, { cx: 690, cy: 560, w: 1040, h: 620, ry: 14, html: `
    ${phead('chart', 'Analytics', 'Systems Analysis and Design · BSIT 3-A', '<span class="btn" id="s14-exp" style="height:40px">' + ic('download', 17) + 'Export</span>')}
    <div style="padding:20px 28px 0">
      <div class="fp-h" style="margin-bottom:10px">Needs attention</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">${flags.map((f) => `<div class="s14-f" style="padding:16px 18px;border-radius:14px;border:1px solid color-mix(in oklab,var(--st-${f[2]}) 45%,transparent);background:color-mix(in oklab,var(--st-${f[2]}) 9%,var(--surface))"><div style="display:flex;align-items:center;gap:8px;color:var(--st-${f[2]})">${ic('alert', 18)}<b style="font-size:17px;color:var(--ink)">${f[0]}</b></div><div style="font-size:15px;color:var(--ink-muted);margin-top:4px">${f[1]}</div></div>`).join('')}</div>
      <div class="fp-h" style="margin:22px 0 10px">Progress by group</div>
      <div style="display:flex;align-items:flex-end;gap:16px;height:200px;padding:0 6px;border-bottom:1px solid var(--line)">${bars.map((v, i) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end"><i class="s14-b" data-h="${v}" style="display:block;width:100%;height:0;border-radius:8px 8px 0 0;background:${v < 50 ? 'var(--st-late)' : 'var(--navy-500)'}"></i><span class="mono" style="font-size:12.5px;color:var(--ink-faint)">G${i + 1}</span></div>`).join('')}</div>
    </div>
    <div id="s14-menu" style="position:absolute;right:28px;top:84px;width:250px;padding:8px;border-radius:16px;background:var(--surface);border:1px solid var(--line-strong);box-shadow:var(--shadow-lift)">${[['Excel', '#0a9a6a'], ['Word', '#1c5d99'], ['Print or PDF', '#e03a40'], ['CSV', '#59627f']].map((o, i) => `<div class="s14-o" style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;font-size:16.5px;font-weight:600"><span style="width:28px;height:28px;border-radius:8px;background:${o[1]};color:#fff;display:grid;place-items:center">${ic('file', 15)}</span>${o[0]}</div>`).join('')}</div>` });
  gsap.set(panel, { scale: 1.03 });
  panelIn(tl, panel, T0 + 0.2, { x: -260 });
  const cur = cursor(panel, 600, 520);

  tl.fromTo(panel.querySelectorAll('.s14-f'), { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.4, ease: 'back.out(1.6)', stagger: 0.14 }, T0 + 0.8);
  panel.querySelectorAll('.s14-b').forEach((n, i) => tl.to(n, { height: n.dataset.h + '%', duration: 0.7, ease: 'power3.out' }, T0 + 1.0 + i * 0.05));
  gsap.set('#s14-menu', { opacity: 0 });
  cur.to(tl, 960, 46, T0 + 2.0, 0.6); cur.click(tl, T0 + 2.65, 960, 46);
  tl.fromTo('#s14-menu', { opacity: 0, y: -10, scale: 0.95 }, { opacity: 1, y: 0, scale: 1, duration: 0.25, ease: 'back.out(1.6)', immediateRender: false }, T0 + 2.7);
  cur.to(tl, 860, 116, T0 + 3.0, 0.45); cur.click(tl, T0 + 3.5, 860, 116);
  tl.to(panel.querySelector('.s14-o'), { backgroundColor: 'var(--surface-sunken)', duration: 0.1 }, T0 + 3.2);
  tl.to('#s14-menu', { opacity: 0, duration: 0.2 }, T0 + 3.6);
  const toast = el(`<div class="toast" style="left:300px;top:540px;font-size:17px">${ic('download', 20)}Formal term record.xlsx</div>`, panel);
  tl.fromTo(toast, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.35, ease: 'back.out(1.6)' }, T0 + 3.7);
  sfx(T0 + 0.8, 'pop'); sfx(T0 + 2.65, 'click'); sfx(T0 + 3.7, 'ding');
});
