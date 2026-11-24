/* Welcome to Collabify (ported from the October film's opening, retimed to T.s01).
   VO v02 "Welcome to Collabify. One place where classes and teams plan, build, and finish together." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const T0 = T.s01 - 0.1, K = 1; // K must stay 1: the mark's fromTo and to overlap and only line up at original durations
  const root = document.getElementById('s01');
  const { fade, cam } = rig(root);

  /* ---- lockup ---- */
  const lock = el(`<div class="p3" style="left:0;top:0;width:1920px;height:1080px">
    <div id="w1-halo" style="position:absolute;left:960px;top:470px;width:900px;height:900px;margin:-450px 0 0 -450px;border-radius:50%;background:radial-gradient(closest-side,rgba(247,199,74,.55),rgba(247,199,74,0) 70%);opacity:0"></div>
    <div id="w1-ring" style="position:absolute;left:960px;top:470px;width:420px;height:420px;margin:-210px 0 0 -210px;border-radius:50%;border:2px solid rgba(247,199,74,.65);opacity:0"></div>
    <div id="w1-ring2" style="position:absolute;left:960px;top:470px;width:420px;height:420px;margin:-210px 0 0 -210px;border-radius:50%;border:1px solid rgba(174,184,225,.5);opacity:0"></div>
    <div id="w1-lock" style="position:absolute;left:0;top:0;width:1920px;height:1080px;display:flex;align-items:center;justify-content:center;gap:34px;padding-bottom:140px;transform-style:preserve-3d">
      <div id="w1-mark" style="position:relative;width:250px;height:202px;transform-style:preserve-3d">
        <img src="assets/img/collabify-logo-dark.png" style="width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 30px 40px rgba(0,0,0,.5))"/>
        <div id="w1-sheen" style="position:absolute;inset:0;-webkit-mask-image:url(assets/img/collabify-logo-dark.png);mask-image:url(assets/img/collabify-logo-dark.png);-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.95) 50%,transparent 65%);background-size:300% 100%;background-position:130% 0"></div>
      </div>
      <div id="w1-word" class="h-xl" style="font-size:218px;display:flex;overflow:hidden;padding:0 8px 40px;margin-bottom:-40px"></div>
    </div>
    <div id="w1-eb" class="ey-a" style="position:absolute;left:0;width:1920px;top:690px;text-align:center;font-size:26px"></div>
  </div>`, cam);

  const word = lock.querySelector('#w1-word');
  const letters = [...'Collabify'].map((c) => el(`<span style="display:inline-block">${c}</span>`, word));

  /* ---- the app, in depth ---- */
  const appHost = el(`<div class="p3" style="left:0;top:0;width:1920px;height:1080px"></div>`, cam);
  const win = el(appWindow({ mode: 'edu', active: 'Home', content: S.home() }), appHost);
  // window centre sits at (1250, 585)
  win.style.left = (1250 - 960) + 'px'; win.style.top = (585 - 540) + 'px';
  gsap.set(win, { scale: 0.64, transformOrigin: '50% 50%' });
  gsap.set(appHost, { opacity: 0 });

  /* satellites */
  const sat = (html, l, t, w, h, z) => { const n = el(`<div class="sat" style="left:${l}px;top:${t}px;width:${w}px;height:${h}px">${html}</div>`, appHost); gsap.set(n, { z, opacity: 0 }); return n; };
  const bars = (n) => [...Array(n)].map((_, i) => `<i style="display:block;width:5px;border-radius:3px;background:var(--amber-300);height:${10 + Math.abs(Math.sin(i * 1.7)) * 28 + (i % 3) * 5}px"></i>`).join('');
  const satVoice = sat(`<div style="display:flex;align-items:center;gap:14px;padding:18px 20px;height:100%"><span style="width:46px;height:46px;border-radius:50%;background:var(--amber-400);color:#101637;display:grid;place-items:center">${ic('mic', 22)}</span><div style="display:flex;gap:4px;align-items:center;height:44px">${bars(18)}</div><span class="mono" style="font-size:13px;color:var(--ink-muted)">0:21</span></div>`, 470, 260, 440, 84, 160);
  const satTask = sat(`<div style="padding:16px 20px"><div class="mono" style="font-size:11px;letter-spacing:.14em;color:var(--amber-300)">TASK</div><div style="font-weight:600;font-size:17px;margin:6px 0 12px">Design the patient record screen</div><div style="display:flex;align-items:center;gap:10px">${av('MV', 'b', 28)}<span class="pill prog">In progress</span><span class="mono" style="font-size:12px;color:var(--ink-muted);margin-left:auto">Oct 14</span></div></div>`, 1530, 190, 330, 140, 190);
  const satFile = sat(`<div style="display:flex;align-items:center;gap:14px;padding:16px 20px;height:100%"><span class="tile">${ic('file', 20)}</span><div><div style="font-weight:600;font-size:16px">Chapter 3 – Methodology.docx</div><div class="mono" style="font-size:12px;color:var(--success-400);margin-top:3px">● Merged into Main</div></div></div>`, 1560, 830, 420, 92, 150);
  const satRing = sat(`<div style="display:flex;align-items:center;gap:16px;padding:16px 20px;height:100%"><svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="7"/><circle id="w1-arc" cx="32" cy="32" r="26" fill="none" stroke="#2fd18f" stroke-width="7" stroke-linecap="round" stroke-dasharray="163" stroke-dashoffset="163" transform="rotate(-90 32 32)"/></svg><div><div class="disp" style="font-size:30px;font-weight:700;line-height:1">62%</div><div style="font-size:13px;color:var(--ink-muted)">Group 3 is on track</div></div></div>`, 520, 800, 300, 96, 130);
  const satTeam = sat(`<div style="display:flex;align-items:center;gap:14px;padding:14px 20px;height:100%">${stack([['AS','a'],['MV','b'],['JB','c'],['RM','d']],38)}<div><div style="font-weight:600;font-size:15px">Group 3</div><div style="font-size:12.5px;color:var(--ink-muted)">4 members · Leader: Joanna</div></div></div>`, 1200, 110, 300, 78, 110);

  /* ---- three words ---- */
  const trio = el(`<div class="p3" style="left:110px;top:330px;width:620px">
      <div class="h-xl" style="font-size:150px"><div class="tw" style="overflow:hidden;padding-bottom:.2em;margin-bottom:-.12em"><span style="display:block">Plan<span class="amb">.</span></span></div><div class="tw" style="overflow:hidden;padding-bottom:.2em;margin-bottom:-.12em"><span style="display:block">Build<span class="amb">.</span></span></div><div class="tw" style="overflow:hidden;padding-bottom:.2em;margin-bottom:-.12em"><span style="display:block">Finish<span class="amb">.</span></span></div></div>
      <div class="ey-a" id="w1-tog" style="margin-top:26px;font-size:24px">Together</div></div>`, cam);
  const tw = trio.querySelectorAll('.tw > span');

  const def = el(`<div class="ey-a" id="w1-def" style="position:absolute;left:150px;top:176px;font-size:15px;letter-spacing:.24em;opacity:0;color:#aeb8e1">Project workspace · classes and teams</div>`, cam);

  /* ===== timeline ===== */
  // 0 – 0.5  dark, dust, floor rising (ground does its own thing)
  tl.fromTo('#w1-halo', { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 1.4, ease: 'power2.out' }, T0 + K * 0.35);
  tl.fromTo('#w1-mark', { rotateY: 200, rotateX: 25, z: -900, scale: 0.35, opacity: 0, x: 645 }, { rotateY: 0, rotateX: 0, z: 0, scale: 1, opacity: 1, x: 645, duration: 1.35, ease: 'expo.out' }, T0 + K * 0.3);
  tl.to('#w1-mark', { x: 0, duration: 0.7, ease: 'expo.inOut' }, T0 + K * 0.95);
  tl.fromTo('#w1-sheen', { backgroundPosition: '130% 0' }, { backgroundPosition: '-30% 0', duration: 1.1, ease: 'power2.inOut' }, T0 + K * 1.25);
  tl.fromTo('#w1-ring', { scale: 0.5, opacity: 0.9 }, { scale: 2.4, opacity: 0, duration: 1.5, ease: 'power2.out' }, T0 + K * 0.9);
  tl.fromTo('#w1-ring2', { scale: 0.5, opacity: 0.8 }, { scale: 3.2, opacity: 0, duration: 1.7, ease: 'power2.out' }, T0 + K * 1.05);
  tl.fromTo('#fx-flash', { opacity: 0 }, { opacity: 0.28, duration: 0.08, yoyo: true, repeat: 1, ease: 'none' }, T0 + K * 1.0);
  // wordmark letters rise under mask, 3D flip
  tl.fromTo(letters, { yPercent: 115, rotateX: -80, opacity: 0 }, { yPercent: 0, rotateX: 0, opacity: 1, duration: 0.8, ease: 'expo.out', stagger: 0.05, transformOrigin: '50% 100%' }, T0 + K * 1.3);
    // eyebrow typed
  tl.fromTo('#w1-eb', { opacity: 0 }, { opacity: 1, duration: 0.3 }, T0 + K * 1.9);
  type(tl, lock.querySelector('#w1-eb'), 'Project workspace for classes and teams', T0 + K * 1.9, 46);

  // lockup → corner (shared-element move), window arrives
  tl.to('#w1-lock', { scale: 0.3, x: -740, y: -392, duration: 1.0, ease: 'expo.inOut' }, T0 + K * 3.55);
  tl.to('#w1-eb', { opacity: 0, y: -10, duration: 0.3 }, T0 + K * 3.5);
  tl.to('#w1-halo', { opacity: 0, duration: 0.8 }, T0 + K * 3.5);
  tl.fromTo(appHost, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power1.out' }, T0 + K * 3.7);
  tl.fromTo(win, { z: -1500, rotateY: -60, rotateX: 20 }, { z: 0, rotateY: -16, rotateX: 5, duration: 1.7, ease: 'expo.out' }, T0 + K * 3.7);
  tl.fromTo([satVoice, satTask, satFile, satRing, satTeam], { opacity: 0, scale: 0.4, rotateY: 40 }, { opacity: 1, scale: 1, rotateY: -16, duration: 0.9, ease: 'back.out(1.5)', stagger: 0.14 }, T0 + K * 4.5);
  tl.fromTo('#w1-arc', { strokeDashoffset: 163 }, { strokeDashoffset: 62, duration: 1.2, ease: 'power2.out' }, T0 + K * 5.0);

  tl.fromTo('#w1-def', { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: 0.6, ease: 'expo.out', immediateRender: false }, T0 + K * 4.1);
  // Plan. Build. Finish. Together
  tl.fromTo(tw[0], { yPercent: 110 }, { yPercent: 0, duration: 0.7, ease: 'expo.out' }, T0 + K * 4.3);
  tl.fromTo(tw[1], { yPercent: 110 }, { yPercent: 0, duration: 0.7, ease: 'expo.out' }, T0 + K * 4.95);
  tl.fromTo(tw[2], { yPercent: 110 }, { yPercent: 0, duration: 0.7, ease: 'expo.out' }, T0 + K * 5.55);
  tl.fromTo('#w1-tog', { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.5 }, T0 + K * 6.15);

  // camera: breathing orbit, then the dive
  tl.fromTo(cam, { rotateY: 4, x: 20 }, { rotateY: -3, x: -20, duration: 3.4, ease: 'sine.inOut' }, T0 + K * 3.7);
  tl.fromTo([satVoice, satTask, satFile, satRing, satTeam], { y: 0 }, { y: (i) => (i % 2 ? 14 : -14), duration: 1.6, ease: 'sine.inOut', yoyo: true, repeat: 1 }, T0 + K * 5.0);
  tl.to(cam, { transformOrigin: '1250px 585px', scale: 2.8, duration: 0.8, ease: 'expo.in' }, T0 + K * 6.7);
  tl.to(fade, { opacity: 0, duration: 0.6, ease: 'power2.in' }, T0 + K * 6.9);
  tl.to(trio, { x: -260, opacity: 0, duration: 0.5, ease: 'power2.in' }, T0 + K * 6.6);
});
