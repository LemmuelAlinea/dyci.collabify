/* Peer evaluation. VO v14 (≈ +0.4 → +2.0): "Students rate their team, too." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const b = beat(tl, { id: 's13', at: T.s13, dur: T.s14 - T.s13, eyebrow: 'Peer evaluation', lines: ['Rate your', '<span class="amb">team.</span>'], left: 1290, w: 540, headTop: 360, diveAt: '700px 560px' });
  const T0 = b.T0;

  const mates = [['JC', 'c', 'Joanna Cruz', 5], ['MR', 'b', 'Miguel Reyes', 4], ['RD', 'd', 'Rafael Dizon', 4]];
  const panel = prodPanel(b.stage, { cx: 700, cy: 560, w: 940, h: 470, ry: 14, html: `
    ${phead('users', 'Rate your team', 'Group 3 · How much did each teammate contribute?')}
    <div style="padding:10px 28px">${mates.map((m, i) => `<div class="fp-row" style="padding:16px 0;gap:16px">${av(m[0], m[1], 44)}<span style="flex:1;font-size:19px;font-weight:600">${m[2]}</span>
      <div style="display:flex;gap:8px">${[1, 2, 3, 4, 5].map((n) => `<span class="s13-s" data-r="${i}" data-n="${n}" style="width:46px;height:46px;border-radius:12px;display:grid;place-items:center;font-family:var(--font-mono);font-size:17px;font-weight:700;border:1px solid var(--line-strong);background:var(--surface-sunken);color:var(--ink-muted)">${n}</span>`).join('')}</div></div>`).join('')}</div>` });
  gsap.set(panel, { scale: 1.04 });
  panelIn(tl, panel, T0 + 0.15, { x: -260 });

  mates.forEach((m, i) => {
    const at = T0 + 1.0 + i * 0.55;
    panel.querySelectorAll(`.s13-s[data-r="${i}"]`).forEach((s) => {
      if (+s.dataset.n <= m[3]) tl.to(s, { backgroundColor: '#26327a', color: '#ffffff', borderColor: '#26327a', duration: 0.12 }, at + (+s.dataset.n) * 0.05);
    });
    sfx(at, 'tick');
  });
});
