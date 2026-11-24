/* Close (ported from the October film): the tunnel of features, the logo, the line.
   VO v16 (≈ +0.4 → +3.1): "Collabify. Plan, build, and finish, together." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const T = window.T.s15 - 0.45; // the logo lands on "Collabify"
  const root = document.getElementById('s15');
  const { fade, cam } = rig(root);
  cam.style.willChange = 'transform';

  /* ---- the tunnel of features ---- */
  const tun = el(`<div class="p3" style="left:0;top:0;width:1920px;height:1080px"></div>`, cam);
  const feats = [
    ['brief', 'Work spaces', 'Every project in one place', '#8dc7ff'],
    ['users', 'Roles and skills', 'Everyone knows their part', '#f0b429'],
    ['spark', 'Tasks from notes', 'Files and meetings become work', '#2fd18f'],
    ['chart', 'Balanced by AI', 'Skills and hours, not guesswork', '#8dc7ff'],
    ['refresh', 'Suggested sprints', 'Paced from your dates', '#f0b429'],
    ['settings', 'Workflow rules', 'When this happens, do that', '#2fd18f'],
    ['video', 'Meetings', 'Talk without leaving', '#8dc7ff'],
    ['cap', 'Classes and grading', 'From syllabus to scores', '#f0b429'],
  ];
  const cards = feats.map((f, i) => {
    const side = i % 2 ? 1 : -1;
    const n = el(`<div class="sat p3" style="left:${960 + side * 560 - 330}px;top:${540 + (i % 3 - 1) * 170 - 130}px;width:660px;height:260px;padding:34px 38px;border-color:${f[3]}77;box-shadow:0 40px 100px rgba(0,0,0,.6),0 0 90px ${f[3]}33;display:flex;gap:26px;align-items:center">
      <span style="flex:none;width:110px;height:110px;border-radius:30px;background:${f[3]};color:#101637;display:grid;place-items:center">${ic(f[0], 58)}</span>
      <div><div class="disp" style="font-size:54px;font-weight:700;letter-spacing:-.035em;line-height:1.02;color:#fff">${f[1]}</div><div style="font-size:21px;color:#b9c0dd;margin-top:8px">${f[2]}</div></div></div>`, tun);
    gsap.set(n, { z: -i * 900 - 500, rotateY: -side * 14 });
    return n;
  });

  /* ---- the lockup ---- */
  const lock = el(`<div class="p3" style="left:0;top:0;width:1920px;height:1080px">
    <div id="w15-halo" style="position:absolute;left:960px;top:420px;width:1100px;height:1100px;margin:-550px 0 0 -550px;border-radius:50%;background:radial-gradient(closest-side,rgba(247,199,74,.5),rgba(247,199,74,0) 70%);opacity:0"></div>
    <div id="w15-ring" style="position:absolute;left:960px;top:420px;width:380px;height:380px;margin:-190px 0 0 -190px;border-radius:50%;border:2px solid rgba(247,199,74,.7);opacity:0"></div>
    <div id="w15-mark" style="position:absolute;left:960px;top:420px;width:300px;height:242px;margin:-121px 0 0 -150px;opacity:0;transform-style:preserve-3d"><img src="assets/img/collabify-logo-dark.png" style="width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 30px 40px rgba(0,0,0,.55))"/></div>
    <div class="h-xl" style="position:absolute;left:0;width:1920px;top:560px;text-align:center;font-size:190px;overflow:hidden;padding:0 0 40px;height:250px"><span id="w15-w" style="display:flex;justify-content:center"></span></div>
    <div style="position:absolute;left:0;width:1920px;top:790px;text-align:center"><div class="h-l" style="font-size:66px;overflow:hidden;padding-bottom:.26em;margin-bottom:-.14em;display:inline-block"><span id="w15-t1" style="display:inline-block">Plan, build, finish<span class="amb">.</span></span></div> <div class="h-l" style="font-size:66px;overflow:hidden;padding-bottom:.26em;margin-bottom:-.14em;display:inline-block;margin-left:22px"><span id="w15-t2" style="display:inline-block;color:#f7c74a">Together<span style="color:#fff">.</span></span></div></div>
    <div id="w15-url" style="position:absolute;left:0;width:1920px;top:930px;text-align:center"><span class="mono" style="display:inline-block;padding:14px 30px;border-radius:999px;border:1px solid rgba(247,199,74,.55);background:rgba(247,199,74,.08);color:#f7c74a;font-size:28px;letter-spacing:.06em">dyci-collabify.vercel.app</span></div>
  </div>`, cam);
  const wd = lock.querySelector('#w15-w');
  const letters = [...'Collabify'].map((c) => el(`<span style="display:inline-block">${c}</span>`, wd));
  gsap.set(lock, { z: 0 });
  gsap.set(['#w15-halo', '#w15-ring', '#w15-mark', '#w15-url'], { opacity: 0 });
  gsap.set(letters, { opacity: 0 });
  gsap.set(['#w15-t1', '#w15-t2'], { yPercent: 120 });

  /* ===== timeline ===== */
  tl.fromTo(fade, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power1.out' }, T);
  // tunnel: fly forward through the features, fast
  tl.fromTo(tun, { z: 0 }, { z: 7400, duration: 1.45, ease: 'power2.in', immediateRender: false }, T);
  cards.forEach((c, i) => tl.fromTo(c, { opacity: 0 }, { opacity: 1, duration: 0.2, immediateRender: false }, T + 0.0 + i * 0.08));
  tl.to(tun, { opacity: 0, duration: 0.15 }, T + 1.3);
  tl.fromTo('#fx-flash', { opacity: 0 }, { opacity: 0.32, duration: 0.05, yoyo: true, repeat: 1, ease: 'none', immediateRender: false }, T + 1.3);

  // logo lands on "Collabify"
  tl.fromTo('#w15-halo', { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 1.4, ease: 'power2.out', immediateRender: false }, T + 1.25);
  tl.fromTo('#w15-mark', { opacity: 0, rotateY: 220, scale: 0.3, z: -700 }, { opacity: 1, rotateY: 0, scale: 1, z: 0, duration: 1.2, ease: 'expo.out', immediateRender: false }, T + 1.25);
  tl.fromTo('#w15-ring', { scale: 0.5, opacity: 0.9 }, { scale: 2.6, opacity: 0, duration: 1.6, ease: 'power2.out', immediateRender: false }, T + 1.5);
  tl.fromTo(letters, { yPercent: 115, rotateX: -80, opacity: 0 }, { yPercent: 0, rotateX: 0, opacity: 1, duration: 0.8, ease: 'expo.out', stagger: 0.05, transformOrigin: '50% 100%', immediateRender: false }, T + 1.4);
  tl.fromTo('#w15-t1', { yPercent: 120 }, { yPercent: 0, duration: 0.7, ease: 'expo.out', immediateRender: false }, T + 2.0);
  tl.fromTo('#w15-t2', { yPercent: 120 }, { yPercent: 0, duration: 0.7, ease: 'expo.out', immediateRender: false }, T + 3.4);
  tl.fromTo('#w15-url', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: 'expo.out', immediateRender: false }, T + 4.1);
  // breathing, to the end
  tl.fromTo(cam, { scale: 1.0 }, { scale: 1.06, duration: 7.6, ease: 'none', immediateRender: false }, T + 1.4);
  tl.fromTo('#w15-ring', { scale: 1, opacity: 0 }, { scale: 1.9, opacity: 0.5, duration: 2.4, ease: 'sine.out', immediateRender: false }, T + 4.3);
});
