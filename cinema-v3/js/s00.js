/* 0:00 – 0:09.5  The hook: one project, scattered across apps.
   VO v00 0.90–4.33 "Chats in one app. Files in another. Deadlines in your head."
   VO v01 4.58–6.83 "What if your whole project lived in one place?" */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const T0 = T.s00;
  const root = document.getElementById('s00');
  const { fade, cam } = rig(root);
  const wrap = document.getElementById('hookwrap');

  /* the three lines, on the dark wall top left */
  const lines = el(`<div class="p3" style="left:110px;top:120px;width:900px">
      <div class="h-l hk" style="font-size:76px"><span class="hw">Chats in one app.</span></div>
      <div class="h-l hk" style="font-size:76px;margin-top:6px"><span class="hw">Files in another.</span></div>
      <div class="h-l hk" style="font-size:76px;margin-top:6px"><span class="hw amb">Deadlines in your head.</span></div>
    </div>`, cam);
  const hk = lines.querySelectorAll('.hw');
  hk.forEach((n) => { n.style.display = 'inline-block'; n.style.textShadow = '0 6px 30px rgba(0,0,0,.65)'; });

  const ask = el(`<div class="p3" style="left:0;top:380px;width:1920px;text-align:center">
      <div class="h-xl" style="font-size:96px;text-shadow:0 8px 40px rgba(0,0,0,.7)"><div id="s0-q1" style="overflow:hidden;padding-bottom:.24em;margin-bottom:-.12em"><span style="display:block">What if your whole project</span></div><div id="s0-q2" style="overflow:hidden;padding-bottom:.24em;margin-bottom:-.12em"><span style="display:block" class="amb">lived in one place?</span></div></div></div>`, cam);
  const qs = ask.querySelectorAll('#s0-q1 > span, #s0-q2 > span');

  /* the pings: scattered apps, each pulling for attention */
  const P = [
    ['message', '#3d8bd9', '27 new messages', 'Group chat · 11:48 PM', 1210, 96],
    ['folder', '#e8903a', 'Final_v3_REAL.docx', 'Which one is the latest?', 1290, 250],
    ['calendar', '#e0568b', 'Due tomorrow, 11:59 PM', 'Chapter 3 draft', 1180, 690],
    ['mail', '#8a5cf5', '“Who’s doing the slides?”', 'Email · 3 replies', 80, 720],
    ['board', '#17a6b8', '14 cards in To do', 'Another board app', 540, 880],
    ['clock', '#27a37a', 'Meeting link changed', 'Video app · in 5 min', 1360, 880],
  ];
  const pings = P.map((p) => {
    const n = el(`<div class="ping" style="left:${p[4]}px;top:${p[5]}px"><span class="pi" style="background:${p[1]}">${ic(p[0], 30)}</span><div><b>${p[2]}</b><s>${p[3]}</s></div></div>`, cam);
    gsap.set(n, { opacity: 0, z: 60 + (p[5] % 5) * 30 });
    return n;
  });

  /* ===== timeline ===== */
  // the clip: slow push, then sink into the dark as the question lands
  tl.fromTo('#hook', { scale: 1.0 }, { scale: 1.12, duration: 9.6, ease: 'none' }, T0);
  tl.fromTo(wrap, { opacity: 1 }, { opacity: 1, duration: 0.01 }, T0);
  tl.to('#hook', { filter: 'brightness(.42) saturate(.7) contrast(1.06) blur(3px)', duration: 1.2, ease: 'power2.inOut' }, T0 + 4.3);

  // lines, in step with the voice
  [0.85, 2.05, 3.1].forEach((t, i) => tl.fromTo(hk[i], { yPercent: 70, opacity: 0, filter: 'blur(8px)' }, { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 0.6, ease: 'expo.out' }, T0 + t));
  // pings pop as each app is named, then keep stacking up
  const pop = [0.95, 1.4, 2.15, 2.6, 3.2, 3.6];
  pings.forEach((n, i) => popIn(tl, n, T0 + pop[i]));
  pings.forEach((n, i) => tl.to(n, { y: i % 2 ? 10 : -10, duration: 1.4, ease: 'sine.inOut', yoyo: true, repeat: 1 }, T0 + pop[i] + 0.6));

  // the question: lines leave, pings are pulled to one point
  tl.to(lines, { opacity: 0, y: -30, duration: 0.45, ease: 'power2.in' }, T0 + 4.35);
  tl.to(pings, { opacity: 0.55, scale: 0.9, filter: 'blur(2px)', duration: 0.6, ease: 'power2.out' }, T0 + 4.45);
  tl.fromTo(qs, { yPercent: 112 }, { yPercent: 0, duration: 0.8, ease: 'expo.out', stagger: 0.5 }, T0 + 4.6);
  pings.forEach((n, i) => tl.to(n, { left: 960 - n.offsetWidth / 2, top: 540 - n.offsetHeight / 2, scale: 0.2, opacity: 0, rotate: (i - 2.5) * 12, duration: 0.9, ease: 'expo.in' }, T0 + 6.9 + i * 0.04));
  tl.to(ask, { scale: 0.9, opacity: 0, duration: 0.5, ease: 'power2.in' }, T0 + 7.6);

  // the convergence point flares, the clip goes, Collabify arrives (s01)
  const dot = el(`<div class="p3" style="left:960px;top:540px;width:240px;height:240px;margin:-120px 0 0 -120px;border-radius:50%;background:radial-gradient(closest-side,#fff 0%,rgba(255,236,190,.95) 18%,rgba(247,199,74,.55) 40%,rgba(247,199,74,0) 100%)"></div>`, cam);
  tl.fromTo(dot, { scale: 0, opacity: 0 }, { scale: 0.6, opacity: 1, duration: 0.4, ease: 'expo.out' }, T0 + 7.75);
  tl.to(dot, { scale: 12, duration: 1.0, ease: 'power3.in' }, T0 + 8.2);
  tl.to(dot, { opacity: 0, duration: 0.35, ease: 'power1.in' }, T0 + 9.0);
  tl.to(wrap, { opacity: 0, duration: 0.7, ease: 'power2.in' }, T0 + 8.5);
  tl.fromTo('#fx-flash', { opacity: 0 }, { opacity: 0.55, duration: 0.14, yoyo: true, repeat: 1, ease: 'none', immediateRender: false }, T0 + 9.05);
  tl.to(fade, { opacity: 0, duration: 0.3 }, T0 + 9.1);
  sfx(T0 + 0.95, 'pop'); sfx(T0 + 7.75, 'whoosh'); sfx(T0 + 9.05, 'hit');
});
