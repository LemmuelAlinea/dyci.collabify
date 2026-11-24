/* Meetings. VO v10 (+0.4 → +5.4): "And when it's time to talk, meet right inside Collabify. No links to another app." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const ppl = [['Joanna Cruz', 'JC', '#c2306a', '#3b0a2a'], ['Miguel Reyes', 'MR', '#2f6fb5', '#0b2540'], ['Rafael Dizon', 'RD', '#6a3fd6', '#1d1145'], ['Bea Lim', 'BL', '#b05510', '#3a1d05']];
  const tile = (p, i) => `<div class="s9-tile" style="position:relative;border-radius:20px;overflow:hidden;background:radial-gradient(120% 120% at 30% 20%,${p[3]},#070a1f)">
      <div class="s9-av" style="position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);width:130px;height:130px;border-radius:50%;background:${p[2]};display:grid;place-items:center;font-family:var(--font-display);font-weight:800;font-size:46px;color:#fff;box-shadow:0 10px 40px rgba(0,0,0,.5)">${p[1]}</div>
      <div style="position:absolute;left:16px;bottom:14px;display:flex;align-items:center;gap:8px;padding:7px 13px;border-radius:10px;background:rgba(0,0,0,.45);color:#fff;font-size:16px;font-weight:600">${p[0]}</div>
      <div class="s9-ring" style="position:absolute;inset:0;border-radius:20px;border:4px solid #f7c74a;opacity:0"></div></div>`;
  const btn = (icon, bg = 'rgba(255,255,255,.12)', wd = 60, id = '') => `<span ${id ? `id="${id}"` : ''} style="width:${wd}px;height:60px;border-radius:999px;background:${bg};display:grid;place-items:center;color:#fff">${ic(icon, 26)}</span>`;
  const content = `
    <div style="display:flex;align-items:center;gap:16px;margin-top:4px"><span class="mk" style="background:#3d8bd9;width:50px;height:50px">P</span><div><div class="eyebrow" style="color:var(--ink-faint)">Lakbay Studio</div><h2 style="font-size:28px;line-height:1.1">Public market app</h2></div><span style="flex:1"></span><span class="btnp" id="s9-start" style="height:48px;font-size:17px">${ic('video', 20)}Start a call</span></div>
    ${tabs([['board', 'Overview'], ['message', 'Discussion'], ['kanban', 'Work'], ['folder', 'Files'], ['settings', 'Settings']], 'Discussion')}
    <div class="card" style="margin-top:22px;padding:22px;height:640px"><div class="fp-h">Design channel</div>${['Joanna: Can we look at the booking flow together?', 'Miguel: Yes, starting a call now.'].map((m) => `<div class="bub" style="margin-top:14px;max-width:560px">${m}</div>`).join('')}</div>
    <div id="s9-call" style="position:absolute;inset:0 0 0 0;background:#0a0e2a;color:#f1f3fb;padding:22px 32px;z-index:8">
      <div style="display:flex;align-items:center;gap:14px"><span style="width:12px;height:12px;border-radius:50%;background:#ff6b6b;box-shadow:0 0 12px #ff6b6b"></span><div style="flex:1"><div class="disp" style="font-size:24px;font-weight:700">Design sync</div><div style="font-size:15px;color:#aeb6d4">Public market app · 4 in the call</div></div><span class="mono" style="font-size:16px;color:#aeb6d4">00:12</span></div>
      <div id="s9-grid" style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:14px;height:820px;margin-top:18px">${ppl.map(tile).join('')}</div>
      <div id="s9-share" style="position:absolute;left:32px;top:96px;width:1180px;height:820px;border-radius:20px;background:#f1f3fb;color:#0d1330;padding:22px">
        <div style="display:flex;align-items:center;gap:10px;font-size:16px;font-weight:600;color:#4a5478">${ic('monitor', 18)}Miguel is sharing the screen</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:16px">${['To do', 'Build', 'Testing'].map((c, i) => `<div style="background:#dde3f0;border-radius:14px;padding:12px;height:700px"><b style="font-size:16px">${c}</b>${[0, 1, 2].slice(0, 3 - i).map(() => '<div style="margin-top:10px;height:90px;border-radius:10px;background:#fff;box-shadow:0 2px 6px rgba(13,19,48,.1)"></div>').join('')}</div>`).join('')}</div></div>
      <div style="position:absolute;left:0;right:0;bottom:26px;display:flex;justify-content:center;gap:16px">${btn('mic')}${btn('video')}${btn('monitor', 'rgba(255,255,255,.12)', 60, 's9-sharebtn')}${btn('message')}${btn('x', '#e03a40', 100)}</div>
    </div>`;
  const cut = shot(tl, { id: 's09', at: T.s09, dur: T.s10 - T.s09, eyebrow: 'Meetings', lines: ['Meet without', '<span class="amb">leaving.</span>'], hold: 1.3, tag: 'Meetings', world: appWindow({ mode: 'work', active: 'Public market app', content }) });
  const T0 = cut.T0, w = cut.world, q = (s) => w.querySelector(s), all = (s) => [...w.querySelectorAll(s)];
  const call = q('#s9-call'), tiles = all('.s9-tile'), rings = all('.s9-ring');
  gsap.set(call, { opacity: 0 }); gsap.set('#s9-share', { opacity: 0 });
  const cur = cut.pointer();

  // start the call from the project
  cut.lookAt(q('#s9-start'), T0 + 1.3, 0.6, { pad: 200 });
  cur.show(T0 + 1.35).tap(q('#s9-start'), T0 + 1.95, 0.45);
  cur.hide(T0 + 2.05);
  const sr = cut.rect(q('#s9-start'), 0), mr = cut.rect(call, 0);
  tl.fromTo(call, { opacity: 0, clipPath: `inset(${sr.y - mr.y}px ${mr.x + mr.w - sr.x - sr.w}px ${mr.y + mr.h - sr.y - sr.h}px ${sr.x - mr.x}px round 14px)` }, { opacity: 1, clipPath: 'inset(0px 0px 0px 0px round 0px)', duration: 0.6, ease: 'expo.inOut', immediateRender: false }, T0 + 2.05);
  cut.lookAt(call, T0 + 2.05, 0.6, { pad: 0 });
  tl.fromTo(tiles, { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(1.5)', stagger: 0.1, immediateRender: false }, T0 + 2.3);
  // whoever talks: the camera leans toward them
  [[0, 2.9], [1, 3.6]].forEach(([i, at]) => { tl.to(rings[i], { opacity: 1, duration: 0.12 }, T0 + at); tl.to(rings[i], { opacity: 0, duration: 0.2 }, T0 + at + 0.65); });
  cut.lookAt(tiles[0], T0 + 2.8, 0.6, { pad: 80 });
  cut.lookAt(tiles[1], T0 + 3.5, 0.5, { pad: 80 });
  // share the screen
  cut.lookAt(q('#s9-sharebtn'), T0 + 4.1, 0.45, { pad: 260 });
  cur.show(T0 + 4.1).tap(q('#s9-sharebtn'), T0 + 4.55, 0.35);
  cur.hide(T0 + 4.65);
  tl.to('#s9-grid', { gridTemplateColumns: '1fr', gridTemplateRows: 'repeat(4,1fr)', paddingLeft: 1210, duration: 0.6, ease: 'expo.inOut' }, T0 + 4.6);
  tl.to(all('.s9-av'), { scale: 0.45, duration: 0.6, ease: 'expo.inOut' }, T0 + 4.6);
  tl.fromTo('#s9-share', { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.6, ease: 'expo.out', immediateRender: false }, T0 + 4.75);
  cut.lookAt(call, T0 + 4.65, 0.8, { pad: 0 });
  cut.lookAt(q('#s9-share'), T0 + 5.6, 1.4, { pad: 40, ease: 'sine.inOut' });
  sfx(T0 + 2.05, 'whoosh'); sfx(T0 + 4.6, 'whoosh');
});
