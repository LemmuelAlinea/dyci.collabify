/* The shared shape of a feature beat: headline on the left, the product on the right,
   a camera that arrives, drifts and dives out. Every feature scene builds on this. */
(function () {
  const W = window;

  /* o: { id, at, dur, eyebrow, lines: [html, html], sub, headTop, size, w } */
  W.beat = function (tl, o) {
    const T0 = o.at, D = o.dur;
    const root = document.getElementById(o.id);
    const { fade, cam } = rig(root);
    const stage = el(`<div class="p3" style="left:0;top:0;width:1920px;height:1080px"></div>`, cam);
    const head = el(`<div class="p3" style="left:${o.left || 112}px;top:${o.headTop || 300}px;width:${o.w || 620}px">
        <div class="ey-a" style="font-size:17px;letter-spacing:.24em">${o.eyebrow || ''}</div>
        <div class="h-l" style="font-size:${o.size || 80}px;margin-top:20px">${o.lines.map((l) => `<div style="overflow:hidden;padding-bottom:.26em;margin-bottom:-.14em"><span class="bl" style="display:block">${l}</span></div>`).join('')}</div>
        ${o.sub ? `<div class="bsub" style="font-size:23px;color:#b9c0dd;margin-top:26px;line-height:1.42;max-width:${(o.w || 620) - 40}px">${o.sub}</div>` : ''}
      </div>`, cam);
    gsap.set(head, { z: 40 });
    const lines = head.querySelectorAll('.bl');

    // arrive
    tl.fromTo(fade, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power1.out' }, T0);
    tl.fromTo(cam, { scale: 1.9, transformOrigin: '960px 540px' }, { scale: 1, duration: 1.05, ease: 'expo.out' }, T0);
    tl.fromTo(head.querySelector('.ey-a'), { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: 0.5, ease: 'expo.out' }, T0 + 0.35);
    tl.fromTo(lines, { yPercent: 112 }, { yPercent: 0, duration: 0.75, ease: 'expo.out', stagger: 0.12 }, T0 + 0.45);
    if (o.sub) tl.fromTo(head.querySelector('.bsub'), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, T0 + 0.85);
    // drift
    tl.fromTo(cam, { rotateY: -3.5, x: 14 }, { rotateY: 3, x: -14, duration: D, ease: 'sine.inOut', immediateRender: false }, T0);
    // leave
    tl.to(cam, { transformOrigin: o.diveAt || '1200px 560px', scale: 2.3, duration: 0.6, ease: 'expo.in' }, T0 + D - 0.55);
    tl.to(fade, { opacity: 0, duration: 0.42, ease: 'power2.in' }, T0 + D - 0.45);

    return { fade, cam, stage, head, hud: hud(fade), T0, D };
  };

  /* A light product panel placed by its centre, tilted toward the headline. */
  W.prodPanel = function (stage, o) {
    const n = el(`<div class="panel ${o.dark ? 'pdark' : ''}" style="left:${o.cx - o.w / 2}px;top:${o.cy - o.h / 2}px;width:${o.w}px;height:${o.h}px;${o.style || ''}">${o.html}</div>`, stage);
    n._z = o.z || 0;
    gsap.set(n, { rotateY: o.ry == null ? -14 : o.ry, rotateX: o.rx == null ? 4 : o.rx, z: n._z, transformOrigin: '50% 50%' });
    return n;
  };
  W.panelIn = (tl, n, at, from = {}) => tl.fromTo(n, Object.assign({ opacity: 0, x: 260, z: -400 }, from), { opacity: 1, x: 0, z: n._z || 0, duration: 1.0, ease: 'expo.out', immediateRender: true }, at);

  /* Header row used inside panels: icon tile, title, optional note and right-hand slot. */
  W.phead = (icon, title, note, right) => `<div style="display:flex;align-items:center;gap:14px;padding:22px 28px;border-bottom:1px solid var(--line)">
      <span class="tile" style="width:46px;height:46px">${ic(icon, 22)}</span>
      <div style="flex:1;min-width:0"><div class="disp" style="font-size:24px;font-weight:700;letter-spacing:-.02em;line-height:1.1">${title}</div>${note ? `<div style="font-size:14px;color:var(--ink-muted);margin-top:3px">${note}</div>` : ''}</div>${right || ''}</div>`;

  /* A small chip. tone: done | prog | late | pend | role */
  W.chip = (t, tone = 'pend', extra = '') => `<span class="pill ${tone}" ${extra}>${t}</span>`;
})();
