/* Sprint suggestion AI. VO v08 (≈ +0.4 → +6.1):
   "Not sure how to pace it? Suggest sprints lays out the cycles for you, from your dates and your work." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const b = beat(tl, { id: 's07', at: T.s07, dur: T.s08 - T.s07, eyebrow: 'Suggest sprints', lines: ['Sprints,', '<span class="amb">suggested.</span>'], sub: 'Cycles laid out from your dates and your work.', w: 520 });
  const T0 = b.T0;

  const SP = [['Sprint 1', 'Jan 5 – Jan 16', ['Booking calendar', 'Payment API', 'Sign-in']], ['Sprint 2', 'Jan 19 – Jan 30', ['Payment screen', 'Emails', 'Reviews']], ['Sprint 3', 'Feb 2 – Feb 13', ['Phone tests', 'Launch page']]];
  const X0 = 40, W = 940, colW = W / 3;
  const panel = prodPanel(b.stage, { cx: 1290, cy: 555, w: 1020, h: 620, html: `
    ${phead('refresh', 'Sprints', 'Public market app · 13 tasks in the backlog', '<span class="btnp" id="s7-btn" style="height:42px;font-size:15.5px">' + ic('spark', 17) + 'Suggest sprints</span>')}
    <div style="padding:22px 40px 0;display:flex;gap:16px">
      ${[['Starts', 'Jan 5'], ['Ends', 'Feb 13'], ['Sprint length', '2 weeks']].map((f) => `<div style="flex:1"><div class="lbl" style="font-size:14.5px">${f[0]}</div><div class="field" style="height:50px;font-size:18px;font-weight:600">${f[1]}</div></div>`).join('')}
    </div>
    <div id="s7-res" style="padding:22px 40px 0;font-size:19px;font-weight:700;display:flex;align-items:center;gap:10px;color:var(--navy-700)">${ic('spark', 20)}Suggested: 3 sprints of 2 weeks</div>
    <div style="position:relative;margin:16px 0 0;height:270px">
      <div style="position:absolute;left:${X0}px;width:${W}px;top:0;display:flex">${['Jan 5', 'Jan 12', 'Jan 19', 'Jan 26', 'Feb 2', 'Feb 9'].map((d) => `<span class="mono" style="flex:1;font-size:13px;color:var(--ink-faint);border-left:1px solid var(--line);padding-left:8px">${d}</span>`).join('')}</div>
      ${SP.map((s, i) => `<div class="s7-sp" style="position:absolute;left:${X0 + i * colW + 6}px;width:${colW - 12}px;top:34px;height:226px;border-radius:16px;border:2px dashed var(--navy-300);background:color-mix(in oklab,var(--navy-100) 45%,transparent);padding:14px 16px">
          <div style="display:flex;align-items:center;justify-content:space-between"><b style="font-size:18px">${s[0]}</b><span class="s7-ok" style="color:var(--st-done)">${ic('checkCircle', 20)}</span></div>
          <div class="mono" style="font-size:13px;color:var(--ink-muted);margin:2px 0 10px">${s[1]}</div>
          ${s[2].map((t) => `<div class="s7-t" style="padding:8px 12px;margin-bottom:7px;border-radius:10px;background:var(--surface);border:1px solid var(--line);font-size:15px;font-weight:600;box-shadow:var(--shadow-card)">${t}</div>`).join('')}</div>`).join('')}
    </div>
    <div style="position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:flex-end;gap:12px;padding:14px 28px;border-top:1px solid var(--line);background:var(--surface)"><span class="btn">Back</span><span class="btnp" style="height:42px">Apply</span></div>` });
  gsap.set(panel, { scale: 1.05 });
  panelIn(tl, panel, T0 + 0.25);
  const cur = cursor(panel, 640, 520);

  const sps = panel.querySelectorAll('.s7-sp'), ts = panel.querySelectorAll('.s7-t'), oks = panel.querySelectorAll('.s7-ok');
  gsap.set([sps, ts, '#s7-res'], { opacity: 0 }); gsap.set(oks, { opacity: 0, scale: 0.3 });
  cur.to(tl, 905, 46, T0 + 1.1, 0.7); cur.click(tl, T0 + 1.9, 905, 46);
  tl.fromTo('#s7-btn', { scale: 1 }, { scale: 0.94, duration: 0.1, yoyo: true, repeat: 1 }, T0 + 1.9);
  tl.fromTo('#s7-res', { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: 0.45, ease: 'expo.out', immediateRender: false }, T0 + 2.3);
  tl.fromTo(sps, { opacity: 0, scaleX: 0.2, transformOrigin: '0% 50%' }, { opacity: 1, scaleX: 1, duration: 0.6, ease: 'expo.out', stagger: 0.25, immediateRender: false }, T0 + 2.6);
  tl.fromTo(ts, { opacity: 0, y: -50 }, { opacity: 1, y: 0, duration: 0.42, ease: 'back.out(1.6)', stagger: 0.11, immediateRender: false }, T0 + 3.6);
  cur.to(tl, 960, 596, T0 + 5.1, 0.7); cur.click(tl, T0 + 5.9, 960, 596);
  tl.to(sps, { borderStyle: 'solid', borderColor: 'var(--navy-500)', duration: 0.2, stagger: 0.08 }, T0 + 6.0);
  tl.to(oks, { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2)', stagger: 0.1 }, T0 + 6.05);
  sfx(T0 + 1.9, 'click'); sfx(T0 + 2.6, 'whoosh'); sfx(T0 + 6.05, 'ding');
});
