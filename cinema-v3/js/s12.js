/* Hand-in and grading. VO v13 (+0.4 → +4.7): "Groups plan and hand in. Teachers grade with a rubric, right on the work." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const crit = [['Analysis', 18, 20], ['Design', 23, 25], ['Documentation', 13, 15], ['Teamwork', 9, 10]];
  const content = `
    <div style="display:flex;align-items:center;gap:16px;margin-top:4px"><span class="mk" style="background:#0a9a6a;width:50px;height:50px">3</span><div><div class="eyebrow" style="color:var(--ink-faint)">Barangay health portal</div><h2 style="font-size:28px;line-height:1.1">Group 3</h2></div><span style="flex:1"></span>${stack([['JC', 'c'], ['MR', 'b'], ['AS', 'a'], ['RD', 'd']], 38)}</div>
    ${tabs([['board', 'Overview'], ['kanban', 'Plan'], ['folder', 'Files'], ['upload', 'Hand-in & grade']], 'Hand-in & grade')}
    <div style="display:grid;grid-template-columns:600px 1fr;gap:26px;margin-top:24px;align-items:start">
      <div id="s12-hand" class="card" style="padding:26px">
        <div class="fp-h">Milestone 2 · due Nov 21</div>
        <div style="display:flex;align-items:center;gap:14px;margin-top:16px;padding:14px;border-radius:14px;border:1px solid var(--line)"><span class="tile" style="background:#1c5d99;color:#fff;border:0">${ic('file', 20)}</span><div><div style="font-size:17px;font-weight:700">System design.docx</div><div class="mono" style="font-size:13px;color:var(--ink-faint)">From Main · version 7</div></div></div>
        <div style="margin-top:20px;display:flex;align-items:center;gap:12px"><span class="btnp" id="s12-btn">${ic('upload', 16)}Hand in</span><span class="pill done" id="s12-in" style="height:32px;font-size:14px">${ic('check', 14)}Handed in Nov 20</span></div>
      </div>
      <div id="s12-score" class="card" style="padding:26px">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><div class="fp-h">Rubric score</div><div class="disp" style="font-size:40px;font-weight:800"><span id="s12-tot">0</span><span style="font-size:20px;color:var(--ink-faint)"> / 70</span></div></div>
        ${crit.map((c) => `<div class="s12-c" style="margin-top:18px"><div style="display:flex;justify-content:space-between;font-size:17px;font-weight:600"><span>${c[0]}</span><span class="mono s12-v">0 / ${c[2]}</span></div><div class="pbar" style="height:12px;margin-top:8px"><i class="s12-b" style="width:0;background:var(--navy-600)"></i></div></div>`).join('')}
      </div>
    </div>`;
  const cut = shot(tl, { id: 's12', at: T.s12, dur: T.s13 - T.s12, eyebrow: 'Hand-in & grade', lines: ['Hand in.', 'Get <span class="amb">graded.</span>'], hold: 1.1, tag: 'Hand-in and grading', world: appWindow({ mode: 'edu', active: 'Barangay health portal', content }) });
  const T0 = cut.T0, w = cut.world, q = (s) => w.querySelector(s), all = (s) => [...w.querySelectorAll(s)];
  gsap.set('#s12-in', { opacity: 0, scale: 0.5 });
  const cur = cut.pointer();

  // the group hands in
  cut.lookAt(q('#s12-hand'), T0 + 1.1, 0.6, { pad: 40 });
  cur.show(T0 + 1.15).tap(q('#s12-btn'), T0 + 1.75, 0.4);
  tl.to('#s12-btn', { opacity: 0, width: 0, padding: 0, duration: 0.25 }, T0 + 1.85);
  tl.to('#s12-in', { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2)' }, T0 + 1.95);
  cur.hide(T0 + 2.05);
  // the teacher grades: the camera follows the rubric down
  const cs = all('.s12-c'), bars = all('.s12-b'), vs = all('.s12-v'), totEl = q('#s12-tot');
  cut.lookAt(q('#s12-score'), T0 + 2.2, 0.55, { pad: 40 });
  const tot = { v: 0 };
  crit.forEach((c, i) => {
    const at = T0 + 2.6 + i * 0.45, o = { v: 0 };
    cut.look(cut.rect(cs[i], 30), at - 0.1, 0.35, { fill: 0.75 });
    tl.to(bars[i], { width: (c[1] / c[2]) * 100 + '%', duration: 0.45, ease: 'power3.out' }, at);
    tl.to(o, { v: c[1], duration: 0.45, ease: 'power3.out', onUpdate: () => { vs[i].textContent = Math.round(o.v) + ' / ' + c[2]; } }, at);
    sfx(at, 'tick');
  });
  tl.to(tot, { v: 63, duration: 1.8, ease: 'power2.out', onUpdate: () => { totEl.textContent = Math.round(tot.v); } }, T0 + 2.6);
  cut.lookAt(q('#s12-score'), T0 + 4.5, 0.7, { pad: 50 });
  sfx(T0 + 1.95, 'ding');
});
