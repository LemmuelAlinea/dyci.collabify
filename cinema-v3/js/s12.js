/* Groups, hand-in and grading. VO v13 (≈ +0.4 → +4.7):
   "Groups plan and hand in. Teachers grade with a rubric, right on the work." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const b = beat(tl, { id: 's12', at: T.s12, dur: T.s13 - T.s12, eyebrow: 'Hand-in & grade', lines: ['Hand in.', 'Get <span class="amb">graded.</span>'], sub: 'Rubric scores, right on the group’s work.', left: 1290, w: 540, diveAt: '700px 560px' });
  const T0 = b.T0;

  const crit = [['Analysis', 18, 20], ['Design', 23, 25], ['Documentation', 13, 15], ['Teamwork', 9, 10]];
  const panel = prodPanel(b.stage, { cx: 680, cy: 560, w: 1060, h: 600, ry: 14, html: `
    ${phead('users', 'Group 3 · Barangay health portal', 'Joanna, Miguel, Angelica, Rafael')}
    <div style="padding:0 28px"><div class="tabs" style="margin-top:6px">${['Overview', 'Plan', 'Files', 'Hand-in & grade'].map((t) => `<div class="t ${t.startsWith('Hand') ? 'on' : ''}" style="font-size:16.5px">${t}</div>`).join('')}</div></div>
    <div style="display:grid;grid-template-columns:1fr 1.1fr;gap:20px;padding:20px 28px">
      <div id="s12-hand" class="card" style="padding:20px">
        <div class="fp-h">Milestone 2</div>
        <div style="display:flex;align-items:center;gap:12px;margin-top:14px;padding:12px;border-radius:12px;border:1px solid var(--line)"><span class="tile" style="background:#1c5d99;color:#fff;border:0">${ic('file', 20)}</span><div><div style="font-size:16.5px;font-weight:700">System design.docx</div><div class="mono" style="font-size:13px;color:var(--ink-faint)">From Main · v7</div></div></div>
        <div style="margin-top:16px"><span class="pill done s12-in" style="height:30px;font-size:14px">${ic('check', 14)}Handed in Nov 20</span></div>
      </div>
      <div class="card" style="padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><div class="fp-h">Score</div><div class="disp" style="font-size:30px;font-weight:800"><span id="s12-tot">0</span><span style="font-size:18px;color:var(--ink-faint)"> / 70</span></div></div>
        ${crit.map((c, i) => `<div style="margin-top:12px"><div style="display:flex;justify-content:space-between;font-size:15.5px;font-weight:600"><span>${c[0]}</span><span class="mono s12-v" data-i="${i}">0 / ${c[2]}</span></div><div class="pbar" style="height:10px;margin-top:6px"><i class="s12-b" data-w="${(c[1] / c[2]) * 100}" style="width:0;background:var(--navy-600)"></i></div></div>`).join('')}
      </div>
    </div>` });
  gsap.set(panel, { scale: 1.03 });
  panelIn(tl, panel, T0 + 0.2, { x: -260 });

  tl.fromTo('#s12-hand', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.45, ease: 'expo.out' }, T0 + 0.8);
  tl.fromTo(panel.querySelector('.s12-in'), { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2)' }, T0 + 1.6);
  const tot = { v: 0 }, totEl = panel.querySelector('#s12-tot');
  crit.forEach((c, i) => {
    const at = T0 + 2.5 + i * 0.35, o = { v: 0 }, v = panel.querySelectorAll('.s12-v')[i];
    tl.to(panel.querySelectorAll('.s12-b')[i], { width: (c[1] / c[2]) * 100 + '%', duration: 0.6, ease: 'power3.out' }, at);
    tl.to(o, { v: c[1], duration: 0.6, ease: 'power3.out', onUpdate: () => { v.textContent = Math.round(o.v) + ' / ' + c[2]; } }, at);
  });
  tl.to(tot, { v: 63, duration: 1.6, ease: 'power2.out', onUpdate: () => { totEl.textContent = Math.round(tot.v); } }, T0 + 2.5);
  sfx(T0 + 1.6, 'ding'); sfx(T0 + 2.5, 'rise');
});
