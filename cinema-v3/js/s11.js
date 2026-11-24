/* Class projects. VO v12 (+0.4 → +5.65): "Projects start from a brief. Tasks come from a file,
   and anything off the brief is flagged." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const rows = [['Interview the health workers', true], ['Draw the patient record ERD', true], ['Design the check-up screen', true], ['Plan the school sports fest', false], ['Test the record search', true]];
  const content = `
    <div style="display:flex;align-items:center;gap:16px;margin-top:4px"><span class="mk" style="background:#0a9a6a;width:50px;height:50px">${ic('cap', 24)}</span><div><div class="eyebrow" style="color:var(--ink-faint)">Systems Analysis and Design</div><h2 style="font-size:28px;line-height:1.1">Barangay health portal</h2></div></div>
    ${tabs([['target', 'Brief'], ['users', 'Groups'], ['check', 'Tasks'], ['calendar', 'Milestones'], ['chart', 'Grades']], 'Tasks')}
    <div style="display:grid;grid-template-columns:520px 1fr;gap:26px;margin-top:24px;align-items:start">
      <div id="s11-brief" class="card" style="padding:26px;background:var(--navy-50);border-color:var(--navy-200)">
        <div style="display:flex;align-items:center;gap:12px"><span class="tile" style="background:var(--navy-700);color:#fff;border:0">${ic('target', 20)}</span><div class="fp-h" style="color:var(--navy-600)">Project brief</div></div>
        <div style="font-size:20px;font-weight:600;margin-top:14px;line-height:1.45">A patient record system for a barangay health center: check-ups, records and search.</div>
        <div style="display:flex;gap:8px;margin-top:16px">${['Records', 'Check-ups', 'Search'].map((t) => `<span class="tag">${t}</span>`).join('')}</div></div>
      <div id="s11-panel" class="card" style="padding:22px">
        <div style="display:flex;align-items:center;gap:12px"><h3 style="font-size:20px;flex:1">From a file</h3><span id="s11-file" style="display:inline-flex;align-items:center;gap:10px;padding:8px 16px 8px 8px;border-radius:12px;border:1px solid var(--line-strong);box-shadow:var(--shadow-card)"><span class="tile" style="background:#1c5d99;color:#fff;border:0;width:34px;height:34px">${ic('file', 17)}</span><b style="font-size:15.5px">Course outline.docx</b></span></div>
        <div id="s11-list" style="margin-top:16px;border:1px solid var(--line);border-radius:14px;overflow:hidden">${rows.map((r) => `<div class="fp-row s11-r" style="padding:14px 18px;gap:14px"><span class="kbox ${r[1] ? 'on' : ''}" style="width:26px;height:26px">${r[1] ? ic('check', 16) : ''}</span>
            <div style="flex:1"><div style="font-size:17px;font-weight:600">${r[0]}</div>${r[1] ? '' : '<div class="s11-why" style="font-size:14.5px;color:var(--st-prog);font-weight:600;margin-top:2px"></div>'}</div>
            <span class="pill ${r[1] ? 'done' : 'prog'} s11-fit" style="height:28px;font-size:13px">${r[1] ? ic('check', 13) + 'Fits' : 'Doesn’t fit'}</span></div>`).join('')}</div></div>
    </div>`;
  const cut = shot(tl, { id: 's11', at: T.s11, dur: T.s12 - T.s11, eyebrow: 'Class projects', lines: ['Tasks that fit', 'the <span class="amb">brief.</span>'], hold: 1.1, tag: 'Class projects', world: appWindow({ mode: 'edu', active: 'Barangay health portal', content }) });
  const T0 = cut.T0, w = cut.world, q = (s) => w.querySelector(s), all = (s) => [...w.querySelectorAll(s)];
  const rs = all('.s11-r'), fits = all('.s11-fit');
  gsap.set(rs, { opacity: 0 }); gsap.set(fits, { opacity: 0, scale: 0.5 }); gsap.set('#s11-file', { opacity: 0 });
  const svg = wireLayer(cut);

  // the brief
  cut.lookAt(q('#s11-brief'), T0 + 1.1, 0.6, { pad: 50 });
  // the file, the tasks it gives
  cut.lookAt(q('#s11-panel'), T0 + 2.0, 0.6, { pad: 30 });
  tl.fromTo('#s11-file', { opacity: 0, y: -80, rotate: -6 }, { opacity: 1, y: 0, rotate: 0, duration: 0.5, ease: 'back.out(1.6)', immediateRender: false }, T0 + 2.15);
  tl.to(rs, { opacity: 1, duration: 0.3, stagger: 0.1 }, T0 + 2.6);
  // each one checked against the brief
  cut.look({ x: cut.rect(q('#s11-brief'), 0).x - 30, y: cut.rect(q('#s11-brief'), 0).y - 40, w: 1560, h: 620 }, T0 + 3.1, 0.55);
  rs.forEach((r, i) => {
    const at = T0 + 3.35 + i * 0.22;
    if (rows[i][1]) wire(tl, svg, cut, q('#s11-brief'), fits[i], at, '#2fd18f', 0.3);
    tl.to(fits[i], { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(2.2)' }, at + 0.25);
  });
  tl.to(svg, { opacity: 0, duration: 0.3 }, T0 + 4.6);
  // the one that doesn't fit: close up, the reason writes itself
  cut.lookAt(rs[3], T0 + 4.45, 0.5, { pad: 40 });
  tl.fromTo(rs[3], { x: 0 }, { x: 10, duration: 0.06, yoyo: true, repeat: 5, ease: 'none', immediateRender: false }, T0 + 4.95);
  tl.to(rs[3], { backgroundColor: 'color-mix(in oklab,var(--st-prog) 10%,var(--surface))', duration: 0.2 }, T0 + 4.95);
  type(tl, q('.s11-why'), 'Not part of the brief: the project is a health record system.', T0 + 5.05, 70);
  cut.lookAt(q('#s11-panel'), T0 + 6.1, 0.7, { pad: 40 });
  sfx(T0 + 2.15, 'drop'); sfx(T0 + 4.95, 'buzz');
});
