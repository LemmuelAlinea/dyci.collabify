/* Built-in meetings. VO v10 (≈ +0.4 → +5.4):
   "And when it's time to talk, meet right inside Collabify. No links to another app." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const b = beat(tl, { id: 's09', at: T.s09, dur: T.s10 - T.s09, eyebrow: 'Meetings', lines: ['Meet without', '<span class="amb">leaving.</span>'], sub: 'Video calls built into every project.', w: 520 });
  const T0 = b.T0;

  const ppl = [['Joanna Cruz', 'JC', '#e0568b', '#3b0a2a'], ['Miguel Reyes', 'MR', '#3d8bd9', '#0b2540'], ['Rafael Dizon', 'RD', '#8a5cf5', '#1d1145'], ['Bea Lim', 'BL', '#e8903a', '#3a1d05']];
  const tile = (p, i) => `<div class="s9-tile" data-i="${i}" style="position:relative;border-radius:18px;overflow:hidden;background:radial-gradient(120% 120% at 30% 20%,${p[3]},#070a1f)">
      <div style="position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);width:108px;height:108px;border-radius:50%;background:${p[2]};display:grid;place-items:center;font-family:var(--font-display);font-weight:800;font-size:40px;color:#fff;box-shadow:0 10px 40px rgba(0,0,0,.5)">${p[1]}</div>
      <div style="position:absolute;left:14px;bottom:12px;display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:10px;background:rgba(0,0,0,.45);color:#fff;font-size:15px;font-weight:600">${i === 1 ? ic('mic', 15) : ''}${p[0]}</div>
      <div class="s9-ring" style="position:absolute;inset:0;border-radius:18px;border:4px solid #f7c74a;opacity:0"></div></div>`;
  const btn = (icon, bg = 'rgba(255,255,255,.12)', w = 56) => `<span style="width:${w}px;height:56px;border-radius:999px;background:${bg};display:grid;place-items:center;color:#fff">${ic(icon, 24)}</span>`;
  const panel = prodPanel(b.stage, { cx: 1260, cy: 555, w: 1060, h: 660, style: 'background:#0a0e2a;border-color:rgba(255,255,255,.14);color:#f1f3fb', html: `
    <div style="display:flex;align-items:center;gap:14px;padding:20px 26px">
      <span style="width:12px;height:12px;border-radius:50%;background:#ff6b6b;box-shadow:0 0 12px #ff6b6b"></span>
      <div style="flex:1"><div class="disp" style="font-size:23px;font-weight:700">Design sync</div><div style="font-size:14.5px;color:#aeb6d4">Public market app · 4 in the call</div></div>
      <span class="mono" style="font-size:15px;color:#aeb6d4">12:48</span></div>
    <div id="s9-grid" style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:12px;height:470px;padding:0 26px">${ppl.map(tile).join('')}</div>
    <div id="s9-share" style="position:absolute;left:26px;top:84px;width:740px;height:470px;border-radius:18px;background:#f1f3fb;color:#0d1330;padding:20px;opacity:0">
      <div style="display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600;color:#4a5478">${ic('monitor', 18)}Miguel is sharing the screen</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px">${['To do', 'Build', 'Testing'].map((c, i) => `<div style="background:#dde3f0;border-radius:12px;padding:10px;height:370px"><b style="font-size:15px">${c}</b>${[0, 1, 2].slice(0, 3 - i).map((k) => `<div style="margin-top:9px;height:62px;border-radius:9px;background:#fff;box-shadow:0 2px 6px rgba(13,19,48,.1)"></div>`).join('')}</div>`).join('')}</div></div>
    <div style="position:absolute;left:0;right:0;bottom:22px;display:flex;justify-content:center;gap:14px">${btn('mic')}${btn('video')}<span id="s9-sharebtn">${btn('monitor')}</span>${btn('message')}${btn('x', '#e03a40', 92)}</div>` });
  gsap.set(panel, { scale: 1.02 });
  panelIn(tl, panel, T0 + 0.25);

  const tiles = panel.querySelectorAll('.s9-tile'), rings = panel.querySelectorAll('.s9-ring');
  tl.fromTo(tiles, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(1.5)', stagger: 0.12 }, T0 + 0.8);
  // whoever talks gets the ring
  [[0, 1.6], [1, 2.6], [3, 3.5]].forEach(([i, at]) => { tl.to(rings[i], { opacity: 1, duration: 0.15 }, T0 + at); tl.to(rings[i], { opacity: 0, duration: 0.2 }, T0 + at + 0.85); });
  // share the screen: the board takes the stage, people move to a strip
  tl.fromTo('#s9-sharebtn span', { backgroundColor: 'rgba(255,255,255,.12)' }, { backgroundColor: '#26327a', duration: 0.2, immediateRender: false }, T0 + 4.3);
  tl.to('#s9-grid', { gridTemplateColumns: '1fr', gridTemplateRows: 'repeat(4,1fr)', paddingLeft: 790, duration: 0.6, ease: 'expo.inOut' }, T0 + 4.4);
  tl.to(panel.querySelectorAll('.s9-tile > div:first-child'), { scale: 0.5, duration: 0.6, ease: 'expo.inOut' }, T0 + 4.4);
  tl.fromTo('#s9-share', { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.6, ease: 'expo.out', immediateRender: false }, T0 + 4.6);
  sfx(T0 + 0.8, 'pop'); sfx(T0 + 4.4, 'whoosh');
});
