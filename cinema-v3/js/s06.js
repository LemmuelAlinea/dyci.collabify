/* Break down and balance, as a camera move over the real dialog.
   VO v07 (≈ +0.4 → +8.6): "Too much for one person? Break down and balance splits a big task,
   and gives each piece to someone with the skills, and the hours, to do it." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const people = [ // name, ini, hue, position, skills, before %, after %, match skill
    ['Miguel Reyes', 'MR', 'b', 'Frontend developer', ['React', 'CSS'], 160, 72],
    ['Joanna Cruz', 'JC', 'c', 'UI designer', ['Figma', 'UX'], 38, 64],
    ['Rafael Dizon', 'RD', 'd', 'Backend developer', ['APIs', 'SQL'], 34, 70],
    ['Carla Mendoza', 'CM', 'f', 'Content writer', ['Copy', 'Email'], 18, 52],
    ['Bea Lim', 'BL', 'e', 'QA tester', ['Testing'], 30, 58],
  ];
  const subs = [['Booking calendar screen', 6, 1, 'Figma'], ['Payment step API', 8, 2, 'APIs'], ['Payment step screen', 6, 0, 'React'], ['Confirmation email', 3, 3, 'Copy'], ['Test bookings on phones', 4, 4, 'Testing']];
  const tone = (p) => (p > 100 ? 'var(--st-late)' : p > 85 ? 'var(--st-prog)' : 'var(--st-done)');
  const board = `
    <div style="display:flex;align-items:center;gap:16px;margin-top:4px"><span class="mk" style="background:#3d8bd9;width:50px;height:50px">P</span><div><div class="eyebrow" style="color:var(--ink-faint)">Lakbay Studio</div><h2 style="font-size:28px;line-height:1.1">Public market app</h2></div></div>
    ${tabs([['board', 'Overview'], ['message', 'Discussion'], ['kanban', 'Work'], ['folder', 'Files'], ['settings', 'Settings']], 'Work')}
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:24px">${['To do', 'Build', 'Testing', 'Done'].map((c) => `<div class="card" style="height:700px;padding:16px;background:var(--surface-sunken)"><b>${c}</b>${[0, 1, 2].map(() => '<div style="height:80px;margin-top:12px;border-radius:12px;background:var(--surface);border:1px solid var(--line)"></div>').join('')}</div>`).join('')}</div>
    <div class="dim" style="background:rgb(3 5 18/.5)"></div>
    <div class="modal" id="s6-m" style="left:150px;top:110px;width:1360px;height:880px">
      <div class="hd"><div style="display:flex;align-items:center;gap:14px"><span class="tile">${ic('spark', 20)}</span><div><h3 style="font-size:22px">Break down Build the booking flow</h3><div style="font-size:14px;color:var(--ink-muted)">Draft subtasks, recommend owners from each person’s hours, then create them in one step.</div></div></div>${ic('x', 22)}</div>
      <div style="display:grid;grid-template-columns:640px 1fr;gap:0;height:720px">
        <div id="s6-left" style="position:relative;padding:22px 26px;border-right:1px solid var(--line)">
          <div class="fp-h" style="margin-bottom:12px">Subtasks</div>
          <div id="s6-big" style="position:absolute;left:26px;right:26px;top:58px;padding:24px;border-radius:16px;border:2px solid var(--st-late);background:color-mix(in oklab,var(--st-late) 8%,var(--surface))">
            <div style="font-size:22px;font-weight:700">Build the booking flow</div>
            <div style="display:flex;align-items:center;gap:10px;margin-top:10px">${av('MR', 'b', 34)}<span style="font-size:16px;color:var(--ink-muted)">Miguel Reyes · 27 h estimated</span></div></div>
          ${subs.map((s, i) => `<div class="s6-sub" style="display:flex;align-items:center;gap:12px;padding:16px 16px;margin-bottom:12px;border:1px solid var(--line);border-radius:14px;background:var(--surface)">
              <span style="flex:1;font-size:17px;font-weight:600;white-space:nowrap">${s[0]}</span><span class="mono" style="font-size:14px;color:var(--ink-muted)">${s[1]} h</span>
              <span class="tag s6-skill" style="font-size:14px">${s[3]}</span><span class="s6-own" style="width:34px">${av(people[s[2]][1], people[s[2]][2], 34)}</span></div>`).join('')}
        </div>
        <div id="s6-right" style="padding:22px 26px">
          <div class="fp-h" style="margin-bottom:12px">People · hours in the window</div>
          ${people.map((p, i) => `<div class="s6-p" style="display:flex;gap:14px;padding:14px 16px;margin-bottom:12px;border:1px solid var(--line);border-radius:14px;background:var(--surface)">
              ${av(p[1], p[2], 42)}<div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px"><b style="font-size:16.5px">${p[0]}</b><span style="font-size:13.5px;color:var(--ink-faint)">· ${p[3]}</span><span class="mono s6-pct" style="margin-left:auto;font-size:14px;font-weight:700;color:${tone(p[5])}">${p[5]}%</span></div>
                <div style="display:flex;align-items:center;gap:10px;margin-top:8px">${p[4].map((t) => `<span class="tag s6-ptag" data-k="${t}" style="height:26px;font-size:13.5px">${t}</span>`).join('')}<div class="lbar" style="height:12px"><i class="s6-bar" style="width:${Math.min(p[5], 100)}%;background:${tone(p[5])}"></i></div></div></div></div>`).join('')}
        </div>
      </div>
      <div style="position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:16px 26px;border-top:1px solid var(--line);background:var(--surface)"><span class="btn">Change window or people</span><span class="btnp" id="s6-go">Create 5 subtasks</span></div>
    </div>`;
  const cut = shot(tl, { id: 's06', at: T.s06, dur: T.s07 - T.s06, eyebrow: 'Break down and balance', lines: ['Too much for', 'one <span class="amb">person?</span>'], lineAt: [0.3, 0.9], hold: 1.75, tag: 'Break down and balance', world: appWindow({ mode: 'work', active: 'Public market app', content: board }) });
  const T0 = cut.T0, w = cut.world, q = (s) => w.querySelector(s);
  const subsEls = w.querySelectorAll('.s6-sub'), owners = w.querySelectorAll('.s6-own'), skills = w.querySelectorAll('.s6-skill');
  const pcards = w.querySelectorAll('.s6-p'), bars = w.querySelectorAll('.s6-bar'), pcts = w.querySelectorAll('.s6-pct');
  gsap.set(subsEls, { opacity: 0 }); gsap.set(owners, { opacity: 0, scale: 0.3 });
  const svg = wireLayer(cut);

  // the overload: the big task, then Miguel's red bar
  cut.lookAt(q('#s6-big'), T0 + 1.75, 0.8, { pad: 60 });
  cut.lookAt(pcards[0], T0 + 2.55, 0.6, { pad: 50 });
  tl.fromTo(pcards[0], { boxShadow: '0 0 0 0 rgba(242,73,79,.0)' }, { boxShadow: '0 0 0 6px rgba(242,73,79,.35)', duration: 0.3, yoyo: true, repeat: 3, immediateRender: false }, T0 + 2.7);
  // split
  cut.lookAt(q('#s6-left'), T0 + 3.25, 0.7, { pad: 10 });
  tl.to('#s6-big', { opacity: 0, scale: 0.85, y: 60, filter: 'blur(8px)', duration: 0.4, ease: 'power2.in' }, T0 + 3.4);
  tl.fromTo(subsEls, { opacity: 0, y: -70, scale: 0.85 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.5)', stagger: 0.1, immediateRender: false }, T0 + 3.6);

  // skills: each piece is wired to the person who has the skill
  cut.lookAt(q('#s6-m'), T0 + 4.45, 0.8, { pad: -20 });
  subs.forEach((s, i) => {
    const at = T0 + 4.75 + i * 0.36;
    const target = [...pcards[s[2]].querySelectorAll('.s6-ptag')].find((n) => n.dataset.k === s[3]);
    tl.to(skills[i], { backgroundColor: '#fdebbf', color: '#7a5200', borderColor: '#f0b429', duration: 0.2 }, at);
    wire(tl, svg, cut, skills[i], target, at + 0.05, '#f0b429', 0.45);
    tl.to(target, { backgroundColor: '#fdebbf', color: '#7a5200', borderColor: '#f0b429', duration: 0.2 }, at + 0.45);
    tl.fromTo(pcards[s[2]], { borderColor: 'var(--line)' }, { borderColor: '#f0b429', duration: 0.2, immediateRender: false }, at + 0.45);
    tl.to(owners[i], { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(2.5)' }, at + 0.5);
    sfx(at + 0.45, 'tick');
  });

  // and the hours: tight on the people as the load evens out
  cut.lookAt(q('#s6-right'), T0 + 6.75, 0.75, { pad: 10 });
  tl.to(svg, { opacity: 0.25, duration: 0.4 }, T0 + 6.75);
  people.forEach((p, i) => {
    const o = { v: p[5] };
    tl.to(bars[i], { width: p[6] + '%', backgroundColor: tone(p[6]), duration: 1.0, ease: 'power3.inOut' }, T0 + 7.2 + i * 0.07);
    tl.to(o, { v: p[6], duration: 1.0, ease: 'power3.inOut', onUpdate: () => { pcts[i].textContent = Math.round(o.v) + '%'; pcts[i].style.color = tone(o.v); } }, T0 + 7.2 + i * 0.07);
  });
  // create
  const go = q('#s6-go'), gr = cut.rect(go, 0);
  cut.lookAt(go, T0 + 8.55, 0.6, { pad: 260 });
  const cur = cursor(w, gr.x - 160, gr.y + 120);
  gsap.set(cur.el, { opacity: 0 });
  tl.to(cur.el, { opacity: 1, duration: 0.15 }, T0 + 8.55);
  cur.to(tl, gr.x + gr.w / 2, gr.y + gr.h / 2, T0 + 8.6, 0.45); cur.click(tl, T0 + 9.1, gr.x + gr.w / 2, gr.y + gr.h / 2);
  const toast = el(`<div class="toast" style="left:${gr.x - 330}px;top:${gr.y - 70}px;font-size:16px">${ic('checkCircle', 19)}5 subtasks created</div>`, w);
  tl.fromTo(toast, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.3, ease: 'back.out(1.6)' }, T0 + 9.2);
  sfx(T0 + 3.6, 'whoosh'); sfx(T0 + 7.2, 'rise'); sfx(T0 + 9.2, 'ding');
});
