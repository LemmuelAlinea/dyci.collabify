/* Class projects. VO v12 (≈ +0.4 → +5.6):
   "Projects start from a brief. Tasks come from a file, and anything off the brief is flagged." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const b = beat(tl, { id: 's11', at: T.s11, dur: T.s12 - T.s11, eyebrow: 'Class projects', lines: ['Tasks that fit', 'the <span class="amb">brief.</span>'], sub: 'Drafted from a file, checked against the project brief.', left: 1290, w: 540, diveAt: '700px 560px' });
  const T0 = b.T0;

  const rows = [['Interview the health workers', true], ['Draw the patient record ERD', true], ['Design the check-up screen', true], ['Plan the school sports fest', false], ['Test the record search', true]];
  const panel = prodPanel(b.stage, { cx: 680, cy: 560, w: 1040, h: 660, ry: 14, html: `
    ${phead('file', 'From a file', 'Barangay health portal · Systems Analysis and Design')}
    <div style="padding:20px 28px 0">
      <div id="s11-brief" style="display:flex;gap:16px;padding:18px 20px;border-radius:16px;background:var(--navy-50);border:1px solid var(--navy-200)">
        <span class="tile" style="background:var(--navy-700);color:#fff;border:0">${ic('target', 20)}</span>
        <div><div class="fp-h" style="color:var(--navy-600)">Project brief</div><div style="font-size:17.5px;font-weight:600;margin-top:4px;line-height:1.4">A patient record system for a barangay health center: check-ups, records and search.</div></div></div>
      <div id="s11-file" style="display:inline-flex;align-items:center;gap:12px;margin-top:16px;padding:10px 18px 10px 10px;border-radius:14px;border:1px solid var(--line-strong);box-shadow:var(--shadow-card)"><span class="tile" style="background:#1c5d99;color:#fff;border:0;width:36px;height:36px">${ic('file', 18)}</span><b style="font-size:16.5px">Course outline.docx</b></div>
      <div style="margin-top:16px;border:1px solid var(--line);border-radius:16px;overflow:hidden">${rows.map((r) => `<div class="fp-row s11-r" style="padding:11px 18px;gap:14px;${r[1] ? '' : 'background:color-mix(in oklab,var(--st-prog) 9%,var(--surface))'}"><span class="kbox ${r[1] ? 'on' : ''}">${r[1] ? ic('check', 16) : ''}</span>
          <div style="flex:1"><div style="font-size:17px;font-weight:600;${r[1] ? '' : 'color:var(--ink-muted)'}">${r[0]}</div>${r[1] ? '' : '<div class="s11-why" style="font-size:14.5px;color:var(--st-prog);font-weight:600">Not part of the brief: the project is a health record system.</div>'}</div>
          <span class="pill ${r[1] ? 'done' : 'prog'} s11-fit">${r[1] ? 'Fits' : 'Doesn’t fit'}</span></div>`).join('')}</div>
    </div>` });
  gsap.set(panel, { scale: 1.02 });
  panelIn(tl, panel, T0 + 0.2, { x: -260 });

  const rs = panel.querySelectorAll('.s11-r'), fits = panel.querySelectorAll('.s11-fit');
  tl.fromTo('#s11-brief', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, ease: 'expo.out' }, T0 + 0.7);
  tl.fromTo('#s11-file', { opacity: 0, y: -60, rotate: -5 }, { opacity: 1, y: 0, rotate: 0, duration: 0.5, ease: 'back.out(1.6)' }, T0 + 2.0);
  tl.fromTo(rs, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.35, ease: 'expo.out', stagger: 0.09 }, T0 + 2.6);
  tl.fromTo(fits, { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(2)', stagger: 0.1 }, T0 + 3.3);
  tl.fromTo(rs[3], { x: 0 }, { x: 8, duration: 0.07, yoyo: true, repeat: 5, ease: 'none', immediateRender: false }, T0 + 4.4);
  sfx(T0 + 2.0, 'drop'); sfx(T0 + 4.4, 'buzz');
});
