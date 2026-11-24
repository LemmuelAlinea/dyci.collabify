/* Peer evaluation. VO v14 (+0.4 → +2.0): "Students rate their team, too." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const mates = [['JC', 'c', 'Joanna Cruz', 5], ['MR', 'b', 'Miguel Reyes', 4], ['RD', 'd', 'Rafael Dizon', 4]];
  const content = `
    <div style="display:flex;align-items:center;gap:16px;margin-top:4px"><span class="mk" style="background:#0a9a6a;width:50px;height:50px">3</span><div><div class="eyebrow" style="color:var(--ink-faint)">Barangay health portal</div><h2 style="font-size:28px;line-height:1.1">Group 3</h2></div></div>
    ${tabs([['board', 'Overview'], ['kanban', 'Plan'], ['folder', 'Files'], ['upload', 'Hand-in & grade']], 'Plan')}
    <div class="dim" style="background:rgb(3 5 18/.45)"></div>
    <div class="modal" id="s13-m" style="left:300px;top:200px;width:920px;height:520px">
      <div class="hd"><div><h3 style="font-size:22px">Rate your team</h3><div style="font-size:14.5px;color:var(--ink-muted)">How much did each teammate contribute?</div></div>${ic('x', 22)}</div>
      <div style="padding:10px 28px">${mates.map((m) => `<div class="fp-row s13-row" style="padding:20px 0;gap:18px">${av(m[0], m[1], 48)}<span style="flex:1;font-size:20px;font-weight:600">${m[2]}</span>
        <div style="display:flex;gap:10px">${[1, 2, 3, 4, 5].map((n) => `<span class="s13-s" data-n="${n}" style="width:52px;height:52px;border-radius:14px;display:grid;place-items:center;font-family:var(--font-mono);font-size:19px;font-weight:700;border:1px solid var(--line-strong);background:var(--surface-sunken);color:var(--ink-muted)">${n}</span>`).join('')}</div></div>`).join('')}</div>
    </div>`;
  const cut = shot(tl, { id: 's13', at: T.s13, dur: T.s14 - T.s13, eyebrow: 'Peer evaluation', lines: ['Rate your', '<span class="amb">team.</span>'], hold: 0.95, tag: 'Peer evaluation', world: appWindow({ mode: 'edu', active: 'Barangay health portal', content }) });
  const T0 = cut.T0, w = cut.world, q = (s) => w.querySelector(s), all = (s) => [...w.querySelectorAll(s)];
  const rows = all('.s13-row');
  const cur = cut.pointer();
  cut.lookAt(q('#s13-m'), T0 + 0.95, 0.5, { pad: 30 });
  cur.show(T0 + 1.0);
  mates.forEach((m, i) => {
    const at = T0 + 1.45 + i * 0.6, cells = [...rows[i].querySelectorAll('.s13-s')];
    cut.lookAt(rows[i], at - 0.35, 0.35, { pad: 40 });
    cur.tap(cells[m[3] - 1], at, 0.3);
    cells.filter((c) => +c.dataset.n <= m[3]).forEach((c, k) => tl.to(c, { backgroundColor: '#26327a', color: '#ffffff', borderColor: '#26327a', duration: 0.1 }, at + k * 0.04));
  });
  cur.hide(T0 + 3.3);
  cut.lookAt(q('#s13-m'), T0 + 3.3, 0.6, { pad: 40 });
});
