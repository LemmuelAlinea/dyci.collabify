/* Suggest sprints. VO v08 (+0.4 → +6.1): "Not sure how to pace it? Suggest sprints lays out the cycles for you,
   from your dates and your work." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const SP = [['Sprint 1', 'Jan 5 – Jan 16', ['Booking calendar', 'Payment API', 'Sign-in']], ['Sprint 2', 'Jan 19 – Jan 30', ['Payment screen', 'Emails', 'Reviews']], ['Sprint 3', 'Feb 2 – Feb 13', ['Phone tests', 'Launch page']]];
  const backlog = ['Booking calendar', 'Payment API', 'Sign-in', 'Payment screen', 'Emails', 'Reviews', 'Phone tests', 'Launch page'];
  const LW = 1180, X0 = 40;
  const content = `
    <div style="display:flex;align-items:center;gap:16px;margin-top:4px"><span class="mk" style="background:#3d8bd9;width:50px;height:50px">P</span><div><div class="eyebrow" style="color:var(--ink-faint)">Lakbay Studio</div><h2 style="font-size:28px;line-height:1.1">Public market app</h2></div></div>
    ${tabs([['board', 'Overview'], ['message', 'Discussion'], ['kanban', 'Work'], ['folder', 'Files'], ['settings', 'Settings']], 'Work')}
    <div style="display:flex;align-items:center;gap:12px;margin-top:22px"><h3 style="font-size:22px">Sprints</h3><span class="cnt">0</span><span style="flex:1"></span><span class="btnp" id="s7-btn">${ic('spark', 17)}Suggest sprints</span></div>
    <div style="display:grid;grid-template-columns:300px 1fr;gap:26px;margin-top:18px">
      <div class="card" id="s7-back" style="padding:16px"><div class="fp-h" style="margin-bottom:10px">Backlog · 8 tasks</div>${backlog.map((b) => `<div class="s7-b" style="padding:10px 12px;margin-bottom:8px;border-radius:10px;background:var(--surface-sunken);border:1px solid var(--line);font-size:15px;font-weight:600">${b}</div>`).join('')}</div>
      <div class="card" id="s7-plan" style="padding:22px 24px">
        <div id="s7-fields" style="display:flex;gap:16px">${[['Starts', 'Jan 5'], ['Ends', 'Feb 13'], ['Sprint length', '2 weeks']].map((f) => `<div class="s7-f" style="flex:1"><div class="lbl">${f[0]}</div><div class="field" style="height:50px;font-size:18px;font-weight:600">${f[1]}</div></div>`).join('')}</div>
        <div id="s7-res" style="margin-top:20px;font-size:19px;font-weight:700;display:flex;align-items:center;gap:10px;color:var(--navy-700)">${ic('spark', 20)}Suggested: 3 sprints of 2 weeks</div>
        <div id="s7-lane" style="position:relative;height:440px;margin-top:16px">
          <div style="position:absolute;left:${X0}px;width:${LW - 80}px;top:18px;height:4px;border-radius:4px;background:var(--line-strong)"></div>
          <div id="s7-fill" style="position:absolute;left:${X0}px;width:0;top:18px;height:4px;border-radius:4px;background:linear-gradient(90deg,var(--navy-600),#f0b429)"></div>
          ${SP.map((s, i) => `<div class="s7-sp" style="position:absolute;left:${X0 + i * ((LW - 80) / 3) + 10}px;width:${(LW - 80) / 3 - 20}px;top:0;">
              <div style="display:flex;align-items:center;gap:10px"><span class="dot" style="width:40px;height:40px;border-radius:50%;background:var(--surface);border:3px solid var(--navy-600);display:grid;place-items:center;font-family:var(--font-mono);font-weight:700;font-size:15px">${i + 1}</span><div><b style="font-size:18px">${s[0]}</b><div class="mono" style="font-size:13px;color:var(--ink-muted)">${s[1]}</div></div><span class="s7-ok" style="margin-left:auto;color:var(--st-done)">${ic('checkCircle', 22)}</span></div>
              <div class="s7-box" style="margin-top:18px;min-height:300px;padding:12px;border-radius:16px;border:2px dashed var(--navy-300);background:color-mix(in oklab,var(--navy-100) 40%,transparent)">${s[2].map((t) => `<div class="s7-t" style="padding:10px 12px;margin-bottom:8px;border-radius:10px;background:var(--surface);border:1px solid var(--line);font-size:15px;font-weight:600;box-shadow:var(--shadow-card)">${t}</div>`).join('')}</div></div>`).join('')}
        </div>
        <div style="display:flex;justify-content:flex-end;gap:12px"><span class="btn">Back</span><span class="btnp" id="s7-apply">Apply</span></div>
      </div>
    </div>`;
  const cut = shot(tl, { id: 's07', at: T.s07, dur: T.s08 - T.s07, eyebrow: 'Suggest sprints', lines: ['Sprints,', '<span class="amb">suggested.</span>'], hold: 1.4, tag: 'Suggest sprints', world: appWindow({ mode: 'work', active: 'Public market app', content }) });
  const T0 = cut.T0, w = cut.world, q = (s) => w.querySelector(s), all = (s) => [...w.querySelectorAll(s)];
  const sps = all('.s7-sp'), ts = all('.s7-t'), bs = all('.s7-b'), oks = all('.s7-ok'), boxes = all('.s7-box');
  gsap.set(['#s7-res', '#s7-plan'], { opacity: 0 }); gsap.set(sps, { opacity: 0 }); gsap.set(ts, { opacity: 0 }); gsap.set(oks, { opacity: 0, scale: 0.3 });
  const cur = cut.pointer();

  // the button
  cut.lookAt(q('#s7-btn'), T0 + 1.4, 0.55, { pad: 160 });
  cur.show(T0 + 1.45).tap(q('#s7-btn'), T0 + 1.95, 0.4);
  tl.to('#s7-plan', { opacity: 1, duration: 0.3 }, T0 + 2.0);
  cur.hide(T0 + 2.1);
  // the cycles flow out left to right
  cut.lookAt(q('#s7-lane'), T0 + 2.1, 0.7, { pad: 30 });
  tl.to('#s7-res', { opacity: 1, duration: 0.3 }, T0 + 2.3);
  tl.to('#s7-fill', { width: LW - 80, duration: 1.2, ease: 'power1.inOut' }, T0 + 2.4);
  sps.forEach((s, i) => tl.fromTo(s, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, ease: 'back.out(1.6)', immediateRender: false }, T0 + 2.5 + i * 0.38));
  // from your dates: the fields light up
  cut.lookAt(q('#s7-fields'), T0 + 3.85, 0.55, { pad: 40 });
  all('.s7-f .field').forEach((f, i) => tl.fromTo(f, { borderColor: 'var(--line-strong)', boxShadow: '0 0 0 0 rgba(240,180,41,0)' }, { borderColor: '#f0b429', boxShadow: '0 0 0 4px rgba(240,180,41,.25)', duration: 0.25, immediateRender: false }, T0 + 4.15 + i * 0.15));
  // and your work: backlog tasks fly into the sprints
  cut.look({ x: cut.rect(q('#s7-back'), 0).x - 30, y: cut.rect(q('#s7-back'), 0).y - 30, w: 1560, h: 760 }, T0 + 4.55, 0.65);
  bs.forEach((b, i) => {
    const t = ts[i], rb = cut.rect(b, 0), rt = cut.rect(t, 0), at = T0 + 4.85 + i * 0.1;
    tl.fromTo(t, { opacity: 0, x: rb.x - rt.x, y: rb.y - rt.y }, { opacity: 1, x: 0, y: 0, duration: 0.6, ease: 'power3.inOut', immediateRender: false }, at);
    tl.to(b, { opacity: 0.25, duration: 0.2 }, at);
  });
  // apply
  cur.show(T0 + 6.0).tap(q('#s7-apply'), T0 + 6.55, 0.45);
  tl.to(boxes, { borderStyle: 'solid', borderColor: 'var(--navy-500)', duration: 0.2, stagger: 0.08 }, T0 + 6.6);
  tl.to(oks, { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2)', stagger: 0.1 }, T0 + 6.65);
  cut.lookAt(q('#s7-lane'), T0 + 6.9, 1.2, { pad: 60, ease: 'sine.inOut' });
  sfx(T0 + 2.4, 'rise'); sfx(T0 + 4.85, 'whoosh'); sfx(T0 + 6.65, 'ding');
});
