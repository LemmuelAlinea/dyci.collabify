/* Full-frame product shots with a moving camera.
   The app window is authored at its real 1920x1080 size inside `world`; the camera moves
   `world` so that whatever the voice is talking about fills the frame. Nothing floats:
   the frame is the screen, and the camera pans, pushes in and pulls out over it. */
(function () {
  const W = window;
  const FW = 1920, FH = 1080;

  /* o: { id, at, dur, eyebrow, lines: [html...], world: html, mode, active, start: rect } */
  W.shot = function (tl, o) {
    const T0 = o.at, D = o.dur;
    const root = document.getElementById(o.id);
    const fade = el(`<div class="fade" style="perspective:2600px"></div>`, root);
    const cam = el(`<div class="cam"></div>`, fade);
    const world = el(`<div class="p3" style="left:0;top:0;width:${FW}px;height:${FH}px;transform-origin:0 0"></div>`, cam);
    const win = el(o.world, world);
    win.style.borderRadius = '0px';
    const scrim = el(`<div style="position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 50%,rgba(5,7,26,.72),rgba(5,7,26,.92));pointer-events:none"></div>`, fade);
    const title = el(`<div style="position:absolute;left:0;top:0;width:${FW}px;height:${FH}px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:none">
        <div class="ey-a t-ey" style="font-size:20px;letter-spacing:.26em">${o.eyebrow || ''}</div>
        <div class="h-xl" style="font-size:${o.size || 128}px;margin-top:22px">${o.lines.map((l) => `<div style="overflow:hidden;padding-bottom:.24em;margin-bottom:-.14em"><span class="tl" style="display:block">${l}</span></div>`).join('')}</div></div>`, fade);
    // the chapter tag that stays on screen while the camera works
    const tag = el(`<div style="position:absolute;left:56px;bottom:52px;display:flex;align-items:center;gap:14px;padding:14px 24px 14px 18px;border-radius:999px;background:rgba(8,11,33,.82);border:1px solid rgba(255,255,255,.18);box-shadow:0 18px 50px rgba(0,0,0,.45);backdrop-filter:blur(8px);pointer-events:none">
        <span style="width:10px;height:10px;border-radius:50%;background:#f7c74a;box-shadow:0 0 14px #f7c74a"></span>
        <span class="disp" style="font-size:28px;font-weight:700;letter-spacing:-.02em;color:#fff">${o.tag || o.lines.join(' ').replace(/<[^>]+>/g, '')}</span></div>`, fade);

    const cut = { T0, D, root, fade, cam, world, win, title, tag, scrim };

    /* camera: frame a rect {x,y,w,h} in world px. fill < 1 leaves air around it. */
    cut.frame = (r, fill = 0.9) => {
      const s = Math.min(FW / r.w, FH / r.h) * fill;
      let x = FW / 2 - (r.x + r.w / 2) * s, y = FH / 2 - (r.y + r.h / 2) * s;
      // never show past the edge of the screen once the screen fills the frame
      if (s >= 1) { x = Math.min(0, Math.max(FW - FW * s, x)); y = Math.min(0, Math.max(FH - FH * s, y)); }
      return { x, y, scale: s };
    };
    cut.look = (r, at, d = 1.1, o2 = {}) => tl.to(world, Object.assign(cut.frame(r, o2.fill || 0.9), { rotateX: o2.rx || 0, rotateY: o2.ry || 0, duration: d, ease: o2.ease || 'power3.inOut' }), at);
    cut.rect = (node, pad = 0) => { const p = posIn(node, world); return { x: p.left - pad, y: p.top - pad, w: p.w + pad * 2, h: p.h + pad * 2 }; };
    cut.lookAt = (node, at, d, o2 = {}) => cut.look(cut.rect(node, o2.pad == null ? 24 : o2.pad), at, d, o2);
    cut.full = { x: 0, y: 0, w: FW, h: FH };

    /* a soft amber ring that marks what the camera is looking at */
    cut.spot = (node, at, d = 1.6, pad = 10) => {
      const r = cut.rect(node, pad);
      const n = el(`<div style="position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;border-radius:16px;border:3px solid #f7c74a;box-shadow:0 0 0 6px rgba(247,199,74,.18),0 0 40px rgba(247,199,74,.35);pointer-events:none;opacity:0;z-index:40"></div>`, world);
      tl.fromTo(n, { opacity: 0, scale: 1.06 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'power2.out', immediateRender: false }, at);
      tl.to(n, { opacity: 0, duration: 0.35 }, at + d);
      return n;
    };

    // opening: title over the dimmed wide shot, then the camera goes in
    const start = o.start || cut.full;
    const H = o.hold || 1.3;
    gsap.set(world, cut.frame(start, 1));
    tl.fromTo(fade, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: 'power1.out' }, T0);
    tl.fromTo(world, { filter: 'blur(10px) brightness(.7)' }, { filter: 'blur(0px) brightness(1)', duration: 0.7, ease: 'power2.out' }, T0 + H + 0.05);
    tl.fromTo(world, Object.assign({}, cut.frame(start, 0.86), { rotateX: 8 }), Object.assign({}, cut.frame(start, 1), { rotateX: 0, duration: H + 0.7, ease: 'power2.out' }), T0);
    tl.fromTo(title.querySelector('.t-ey'), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.45, ease: 'expo.out' }, T0 + 0.15);
    title.querySelectorAll('.tl').forEach((n, i) => tl.fromTo(n, { yPercent: 112 }, { yPercent: 0, duration: 0.7, ease: 'expo.out' }, T0 + (o.lineAt ? o.lineAt[i] : 0.2 + i * 0.1)));
    tl.to(title, { opacity: 0, scale: 1.08, duration: 0.45, ease: 'power2.in' }, T0 + H);
    tl.to(scrim, { opacity: 0, duration: 0.6, ease: 'power2.inOut' }, T0 + H + 0.05);
    tl.fromTo(tag, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.5, ease: 'expo.out' }, T0 + H + 0.45);
    // a breath of handheld drift on top of every move
    tl.fromTo(cam, { x: -6, y: 3, rotateZ: -0.25 }, { x: 6, y: -3, rotateZ: 0.25, duration: D, ease: 'sine.inOut' }, T0);
    // leaving: push through, blur, fade
    tl.to(cam, { scale: 1.35, transformOrigin: '960px 540px', filter: 'blur(6px)', duration: 0.55, ease: 'power3.in' }, T0 + D - 0.55);
    tl.to(fade, { opacity: 0, duration: 0.4, ease: 'power2.in' }, T0 + D - 0.4);
    tl.to(tag, { opacity: 0, duration: 0.25 }, T0 + D - 0.7);
    return cut;
  };

  /* An SVG overlay in world space for wires and lines drawn between nodes. */
  W.wireLayer = (cut) => {
    const n = el(`<svg width="1920" height="1080" style="position:absolute;left:0;top:0;overflow:visible;pointer-events:none;z-index:30"></svg>`, cut.world);
    return n;
  };
  W.wire = (tl, svg, cut, a, b, at, color = '#f0b429', d = 0.6, vert = false) => {
    const ra = cut.rect(a, 0), rb = cut.rect(b, 0);
    let x1, y1, x2, y2, path;
    if (vert) {
      x1 = ra.x + ra.w / 2; y1 = ra.y + ra.h; x2 = rb.x + rb.w / 2; y2 = rb.y; const my = (y1 + y2) / 2;
      path = `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
    } else {
      x1 = ra.x + ra.w; y1 = ra.y + ra.h / 2; x2 = rb.x; y2 = rb.y + rb.h / 2; const mx = (x1 + x2) / 2;
      path = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
    }
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', path);
    p.setAttribute('fill', 'none'); p.setAttribute('stroke', color); p.setAttribute('stroke-width', '3'); p.setAttribute('stroke-linecap', 'round');
    p.style.filter = `drop-shadow(0 0 6px ${color})`;
    svg.appendChild(p);
    const len = Math.hypot(x2 - x1, y2 - y1) * 1.25 + 40;
    p.setAttribute('stroke-dasharray', len); p.setAttribute('stroke-dashoffset', len);
    tl.to(p, { attr: { 'stroke-dashoffset': 0 }, duration: d, ease: 'power2.inOut' }, at);
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '6'); dot.setAttribute('cx', x2); dot.setAttribute('cy', y2); dot.setAttribute('fill', color); dot.style.opacity = 0;
    svg.appendChild(dot);
    tl.fromTo(dot, { opacity: 0, attr: { r: 2 } }, { opacity: 1, attr: { r: 7 }, duration: 0.25, ease: 'back.out(3)', immediateRender: false }, at + d - 0.05);
    return p;
  };
})();
