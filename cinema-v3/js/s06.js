/* Workload balancing AI. VO v07 (≈ +0.4 → +8.6):
   "Too much for one person? Break down and balance splits a big task, and gives each piece
    to someone with the skills, and the hours, to do it." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const b = beat(tl, { id: 's06', at: T.s06, dur: T.s07 - T.s06, eyebrow: 'Break down and balance', lines: ['Fair work,', 'balanced by <span class="amb">AI.</span>'], sub: 'Big tasks split by skills and hours, so no one is buried.', w: 560 });
  const T0 = b.T0;

  const people = [ // name, ini, hue, before %, after %
    ['Miguel Reyes', 'MR', 'b', 160, 72],
    ['Joanna Cruz', 'JC', 'c', 38, 64],
    ['Rafael Dizon', 'RD', 'd', 34, 70],
    ['Carla Mendoza', 'CM', 'f', 18, 52],
    ['Bea Lim', 'BL', 'e', 30, 58],
  ];
  const subs = [ // title, hours, owner index, skill
    ['Booking calendar screen', 6, 1, 'Figma'],
    ['Payment step API', 8, 2, 'APIs'],
    ['Payment step screen', 6, 0, 'React'],
    ['Confirmation email', 3, 3, 'Copy'],
    ['Test bookings on phones', 4, 4, 'Testing'],
  ];
  const tone = (p) => (p > 100 ? 'var(--st-late)' : p > 85 ? 'var(--st-prog)' : 'var(--st-done)');
  const panel = prodPanel(b.stage, { cx: 1290, cy: 555, w: 1080, h: 640, html: `
    ${phead('spark', 'Break down Build the booking flow', 'Draft subtasks, recommend owners from each person’s hours, then create them in one step.')}
    <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:0;height:470px">
      <div style="position:relative;padding:18px 24px;border-right:1px solid var(--line)">
        <div class="fp-h" style="margin-bottom:10px">Subtasks</div>
        <div id="s6-big" style="position:absolute;left:24px;right:24px;top:52px;padding:22px;border-radius:16px;border:2px solid var(--st-late);background:color-mix(in oklab,var(--st-late) 8%,var(--surface))">
          <div style="font-size:21px;font-weight:700">Build the booking flow</div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:10px">${av('MR', 'b', 32)}<span style="font-size:16px;color:var(--ink-muted)">Miguel Reyes · 27 h estimated</span></div></div>
        <div id="s6-subs">${subs.map((s) => `<div class="s6-sub" style="display:flex;align-items:center;gap:12px;padding:11px 14px;margin-bottom:8px;border:1px solid var(--line);border-radius:13px;background:var(--surface)">
            <span style="flex:1;font-size:16.5px;font-weight:600;white-space:nowrap">${s[0]}</span><span class="mono" style="font-size:14px;color:var(--ink-muted)">${s[1]} h</span>
            <span class="tag s6-skill" style="height:26px;font-size:13.5px">${s[3]}</span><span class="s6-own">${av(people[s[2]][1], people[s[2]][2], 32)}</span></div>`).join('')}</div>
      </div>
      <div style="padding:18px 26px">
        <div class="fp-h" style="margin-bottom:14px">Hours in the window</div>
        ${people.map((p, i) => `<div style="display:flex;align-items:center;gap:12px;margin-bottom:17px">${av(p[1], p[2], 36)}<div style="flex:1"><div style="display:flex;justify-content:space-between;font-size:15.5px;font-weight:600;margin-bottom:6px"><span>${p[0]}</span><span class="mono s6-pct" data-i="${i}" style="font-size:14px">${p[3]}%</span></div><div class="lbar"><i class="s6-bar" data-i="${i}" style="width:${Math.min(p[3], 100)}%;background:${tone(p[3])}"></i></div></div></div>`).join('')}
      </div>
    </div>
    <div style="position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:16px 28px;border-top:1px solid var(--line);background:var(--surface)"><span class="btn">Change window or people</span><span class="btnp">Create 5 subtasks</span></div>` });
  gsap.set(panel, { scale: 1.04 });
  panelIn(tl, panel, T0 + 0.25);

  const subsEls = panel.querySelectorAll('.s6-sub'), owners = panel.querySelectorAll('.s6-own'), skills = panel.querySelectorAll('.s6-skill');
  gsap.set(subsEls, { opacity: 0 }); gsap.set(owners, { opacity: 0, scale: 0.3 });
  // too much for one person: the big task and Miguel's red bar pulse
  tl.fromTo('#s6-big', { scale: 1 }, { scale: 1.03, duration: 0.35, yoyo: true, repeat: 3, ease: 'sine.inOut' }, T0 + 0.9);
  // split
  tl.to('#s6-big', { opacity: 0, scale: 0.9, y: 40, filter: 'blur(6px)', duration: 0.45, ease: 'power2.in' }, T0 + 2.3);
  tl.fromTo(subsEls, { opacity: 0, y: -40, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.5)', stagger: 0.12, immediateRender: false }, T0 + 2.55);
  // owners by skill
  tl.fromTo(skills, { backgroundColor: 'rgba(0,0,0,0)' }, { backgroundColor: '#fdebbf', color: '#7a5200', duration: 0.3, stagger: 0.15, immediateRender: false }, T0 + 4.7);
  tl.to(owners, { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(2)', stagger: 0.15 }, T0 + 5.0);
  // and the hours: bars settle
  people.forEach((p, i) => {
    const bar = panel.querySelector(`.s6-bar[data-i="${i}"]`), pct = panel.querySelector(`.s6-pct[data-i="${i}"]`);
    tl.to(bar, { width: p[4] + '%', backgroundColor: tone(p[4]), duration: 1.0, ease: 'power3.inOut' }, T0 + 6.7 + i * 0.08);
    const o = { v: p[3] };
    tl.to(o, { v: p[4], duration: 1.0, ease: 'power3.inOut', onUpdate: () => { pct.textContent = Math.round(o.v) + '%'; } }, T0 + 6.7 + i * 0.08);
  });
  const co = callout(b.hud, { x: 1260, y: 900, w: 440, icon: 'check', eyebrow: 'Everyone has room', title: 'No one over their hours', accent: '#2fd18f' });
  tl.to(co, { opacity: 1, z: 140, duration: 0.5, ease: 'expo.out' }, T0 + 8.0);
  tl.to(co, { opacity: 0, duration: 0.3 }, T0 + 9.6);
  sfx(T0 + 2.55, 'whoosh'); sfx(T0 + 5.0, 'pop'); sfx(T0 + 6.7, 'rise');
});
