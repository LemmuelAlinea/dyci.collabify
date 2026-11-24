/* Tasks from a file or a discussion. VO v06 (+0.4 → +9.55): "Turn a file or a meeting into work. Upload a plan,
   or pick a saved discussion, and Collabify drafts the tasks. You keep only what you want." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const drafts = [['Design the booking calendar', 'Design', 'High'], ['Build the payment step', 'Development', 'High'], ['Write the refund policy page', 'Design', 'Normal'], ['Order new office chairs', '—', 'Low'], ['Test bookings on a phone', 'Quality', 'Normal']];
  const content = `
    <div style="display:flex;align-items:center;gap:16px;margin-top:4px"><span class="mk" style="background:#3d8bd9;width:50px;height:50px">P</span><div><div class="eyebrow" style="color:var(--ink-faint)">Lakbay Studio</div><h2 style="font-size:28px;line-height:1.1">Public market app</h2></div></div>
    ${tabs([['board', 'Overview'], ['message', 'Discussion'], ['kanban', 'Work'], ['folder', 'Files'], ['settings', 'Settings']], 'Work')}
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:24px">${['To do', 'Build', 'Testing', 'Done'].map((c) => `<div class="card" style="height:700px;padding:16px;background:var(--surface-sunken)"><b>${c}</b>${[0, 1].map(() => '<div style="height:80px;margin-top:12px;border-radius:12px;background:var(--surface);border:1px solid var(--line)"></div>').join('')}</div>`).join('')}</div>
    <div class="dim" style="background:rgb(3 5 18/.5)"></div>
    <div class="modal" id="s5-m" style="left:260px;top:100px;width:1060px;height:880px">
      <div class="hd"><div style="display:flex;align-items:center;gap:14px"><span class="tile">${ic('spark', 20)}</span><div><h3 style="font-size:22px">Tasks from notes</h3><div style="font-size:14px;color:var(--ink-muted)">Keep what you want. Nothing is added until you choose.</div></div></div>${ic('x', 22)}</div>
      <div style="padding:24px 30px 0"><div class="seg" id="s5-seg"><span>Paste notes</span><span class="on">Upload a file</span><span id="s5-disc-tab">From a discussion</span></div></div>
      <div id="s5-body" style="position:relative;height:600px;margin:22px 30px 0">
        <div id="s5-up" style="position:absolute;left:0;right:0;top:0;height:160px;border:2px dashed var(--line-strong);border-radius:18px;display:flex;align-items:center;justify-content:center;gap:14px;color:var(--ink-faint);font-size:18px">${ic('upload', 26)}<span id="s5-uptx">Drop a PDF, Word, Excel or text file</span></div>
        <div id="s5-file" style="position:absolute;left:40px;top:48px;display:flex;align-items:center;gap:14px;padding:14px 22px 14px 14px;border-radius:16px;background:var(--surface);border:1px solid var(--line-strong);box-shadow:var(--shadow-lift)"><span class="tile" style="background:#e03a40;color:#fff;border:0">${ic('pdf', 22)}</span><div><div style="font-size:18px;font-weight:700">Booking site plan.pdf</div><div class="mono" style="font-size:13.5px;color:var(--ink-faint)">4 pages · 312 KB</div></div></div>
        <div id="s5-disc" style="position:absolute;left:0;right:0;top:0"><div class="lbl" style="font-size:15px">Discussion</div>
          <div class="field" style="height:60px;font-size:18px;gap:12px">${ic('wave', 22)}<b style="font-weight:600">Design / Kickoff call</b><span style="color:var(--ink-faint)">· Nov 18 · 42 min</span><span style="margin-left:auto">${ic('chevronDown', 18)}</span></div></div>
        <div id="s5-list" style="position:absolute;left:0;right:0;top:110px;border:1px solid var(--line);border-radius:16px;overflow:hidden">
          <div id="s5-scan" style="position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,transparent,#f0b429,transparent);box-shadow:0 0 18px #f0b429;z-index:3"></div>
          ${drafts.map((d) => `<div class="fp-row s5-d" style="padding:16px 22px;gap:16px"><span class="kbox on s5-k" style="width:28px;height:28px">${ic('check', 18)}</span><span style="flex:1;font-size:18px;font-weight:600">${d[0]}</span><span class="tag">${d[1]}</span><span class="pill ${d[2] === 'High' ? 'late' : d[2] === 'Low' ? 'pend' : 'prog'}" style="width:78px;justify-content:center">${d[2]}</span></div>`).join('')}
        </div>
      </div>
      <div style="position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:18px 30px;border-top:1px solid var(--line);background:var(--surface)"><span class="btn">Cancel</span><span class="btnp" id="s5-add">Add <b class="s5-n" style="font-weight:700">5</b> tasks</span></div>
    </div>`;
  const cut = shot(tl, { id: 's05', at: T.s05, dur: T.s06 - T.s05, eyebrow: 'Tasks from notes', lines: ['From notes', 'to <span class="amb">tasks.</span>'], hold: 1.6, tag: 'Tasks from a file or a discussion', world: appWindow({ mode: 'work', active: 'Public market app', content }) });
  const T0 = cut.T0, w = cut.world, q = (s) => w.querySelector(s);
  const segs = w.querySelectorAll('#s5-seg span'), rows = w.querySelectorAll('.s5-d');
  const seg = (i, at) => segs.forEach((s, j) => tl.set(s, { attr: { class: i === j ? 'on' : '' } }, at));
  gsap.set(['#s5-file', '#s5-disc', '#s5-list'], { opacity: 0 });
  const cur = cut.pointer();

  cut.lookAt(q('#s5-m'), T0 + 1.6, 0.8, { pad: 20 });
  // upload a plan: in on the drop zone as the file lands
  cut.lookAt(q('#s5-up'), T0 + 2.35, 0.6, { pad: 50 });
  tl.fromTo('#s5-file', { opacity: 0, y: -160, rotate: -8, scale: 1.15 }, { opacity: 1, y: 0, rotate: 0, scale: 1, duration: 0.55, ease: 'back.out(1.5)', immediateRender: false }, T0 + 2.7);
  tl.to('#s5-uptx', { opacity: 0, duration: 0.2 }, T0 + 2.75);
  tl.fromTo('#s5-up', { borderColor: 'var(--line-strong)' }, { borderColor: '#f0b429', duration: 0.2, immediateRender: false }, T0 + 2.75);
  // or a saved discussion
  cut.lookAt(q('#s5-seg'), T0 + 3.45, 0.5, { pad: 40 });
  cur.show(T0 + 3.4).tap(q('#s5-disc-tab'), T0 + 3.95, 0.4); seg(2, T0 + 4.0);
  tl.to(['#s5-up', '#s5-file'], { opacity: 0, duration: 0.2 }, T0 + 4.0);
  tl.fromTo('#s5-disc', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.35, immediateRender: false }, T0 + 4.1);
  cur.hide(T0 + 4.4);
  // drafts the tasks: a scan line runs down as rows appear
  cut.lookAt(q('#s5-body'), T0 + 5.0, 0.7, { pad: 20 });
  tl.set('#s5-list', { opacity: 1 }, T0 + 5.4);
  tl.fromTo('#s5-scan', { top: 0, opacity: 1 }, { top: 330, duration: 1.4, ease: 'none', immediateRender: false }, T0 + 5.4);
  tl.to('#s5-scan', { opacity: 0, duration: 0.2 }, T0 + 6.8);
  tl.fromTo(rows, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.35, ease: 'expo.out', stagger: 0.27, immediateRender: false }, T0 + 5.45);
  // keep only what you want: untick the chairs, close up
  const k = w.querySelectorAll('.s5-k')[3];
  cut.lookAt(rows[3], T0 + 7.2, 0.55, { pad: 60 });
  cur.show(T0 + 7.2).tap(k, T0 + 7.75, 0.4);
  tl.set(k, { attr: { class: 'kbox s5-k' }, innerHTML: '' }, T0 + 7.8);
  tl.to(rows[3], { opacity: 0.4, duration: 0.25 }, T0 + 7.8);
  tl.set(q('.s5-n'), { textContent: '4' }, T0 + 7.85);
  cut.lookAt(q('#s5-add'), T0 + 8.3, 0.55, { pad: 220 });
  cur.tap(q('#s5-add'), T0 + 8.95, 0.45);
  const ar = cut.rect(q('#s5-add'), 0);
  const toast = el(`<div class="toast" style="left:${ar.x - 360}px;top:${ar.y - 74}px;font-size:16px">${ic('checkCircle', 19)}4 tasks added to Planning</div>`, w);
  tl.fromTo(toast, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.3, ease: 'back.out(1.6)' }, T0 + 9.05);
  sfx(T0 + 2.7, 'drop'); sfx(T0 + 5.45, 'whoosh'); sfx(T0 + 9.05, 'ding');
});
