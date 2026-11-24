/* Tasks from a file or a discussion. VO v06 (≈ +0.4 → +9.6):
   "Turn a file or a meeting into work. Upload a plan, or pick a saved discussion,
    and Collabify drafts the tasks. You keep only what you want." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const b = beat(tl, { id: 's05', at: T.s05, dur: T.s06 - T.s05, eyebrow: 'Tasks from notes', lines: ['From notes', 'to <span class="amb">tasks.</span>'], sub: 'Upload a file or pick a saved discussion. Collabify drafts the work.', w: 580 });
  const T0 = b.T0;

  const drafts = [
    ['Design the booking calendar', 'Design', 'High'],
    ['Build the payment step', 'Development', 'High'],
    ['Write the refund policy page', 'Design', 'Normal'],
    ['Order new office chairs', '—', 'Low'],
    ['Test bookings on a phone', 'Quality', 'Normal'],
  ];
  const panel = prodPanel(b.stage, { cx: 1290, cy: 560, w: 1000, h: 700, html: `
    ${phead('spark', 'Tasks from notes', 'Keep what you want. Nothing is added until you choose.')}
    <div style="padding:22px 30px 0"><div class="seg" id="s5-seg"><span>Paste notes</span><span class="on">Upload a file</span><span>From a discussion</span></div></div>
    <div style="position:relative;height:440px;margin:18px 30px 0">
      <div id="s5-up" style="position:absolute;inset:0 0 auto 0;height:150px;border:2px dashed var(--line-strong);border-radius:18px;display:flex;align-items:center;justify-content:center;gap:14px;color:var(--ink-faint);font-size:18px">${ic('upload', 26)}Drop a PDF, Word, Excel or text file</div>
      <div id="s5-file" style="position:absolute;left:30px;top:44px;display:flex;align-items:center;gap:14px;padding:14px 22px 14px 14px;border-radius:16px;background:var(--surface);border:1px solid var(--line-strong);box-shadow:var(--shadow-lift)"><span class="tile" style="background:#e03a40;color:#fff;border:0">${ic('pdf', 22)}</span><div><div style="font-size:18px;font-weight:700">Booking site plan.pdf</div><div class="mono" style="font-size:13.5px;color:var(--ink-faint)">4 pages · 312 KB</div></div></div>
      <div id="s5-disc" style="position:absolute;inset:0 0 auto 0;opacity:0">
        <div class="lbl" style="font-size:15px">Discussion</div>
        <div class="field" style="height:58px;font-size:18px;gap:12px">${ic('wave', 22)}<b style="font-weight:600">Design / Kickoff call</b><span style="color:var(--ink-faint)">· Nov 18 · 42 min</span><span style="margin-left:auto">${ic('chevronDown', 18)}</span></div>
      </div>
      <div id="s5-read" style="position:absolute;left:0;right:0;top:96px;opacity:0;display:flex;align-items:center;gap:12px;font-size:17px;color:var(--ink-muted)"><span id="s5-spin" style="width:22px;height:22px;border-radius:50%;border:3px solid var(--navy-200);border-top-color:var(--navy-600)"></span>Reading the file for tasks, sprints and milestones…</div>
      <div id="s5-list" style="position:absolute;left:0;right:0;top:96px;border:1px solid var(--line);border-radius:16px;overflow:hidden">
        ${drafts.map((d, i) => `<div class="fp-row s5-d" style="padding:12px 20px;gap:14px"><span class="kbox on s5-k">${ic('check', 16)}</span><span style="flex:1;font-size:17.5px;font-weight:600">${d[0]}</span><span class="tag">${d[1]}</span><span class="pill ${d[2] === 'High' ? 'late' : d[2] === 'Low' ? 'pend' : 'prog'}" style="width:74px;justify-content:center">${d[2]}</span></div>`).join('')}
      </div>
    </div>
    <div style="position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:18px 30px;border-top:1px solid var(--line);background:var(--surface)"><span class="btn">Cancel</span><span class="btnp" id="s5-add">Add <b class="s5-n" style="font-weight:700">5</b> tasks</span></div>` });
  gsap.set(panel, { scale: 1.06 });
  panelIn(tl, panel, T0 + 0.25);
  const cur = cursor(panel, 640, 560);

  const segs = panel.querySelectorAll('#s5-seg span');
  const seg = (i, at) => segs.forEach((s, j) => tl.set(s, { attr: { class: i === j ? 'on' : '' } }, at));
  const list = panel.querySelector('#s5-list'), rows = panel.querySelectorAll('.s5-d');
  gsap.set(['#s5-file'], { opacity: 0 }); gsap.set(list, { opacity: 0 });

  // upload a plan
  tl.fromTo('#s5-file', { opacity: 0, y: -120, rotate: -6, scale: 1.1 }, { opacity: 1, y: 0, rotate: 0, scale: 1, duration: 0.6, ease: 'back.out(1.6)', immediateRender: false }, T0 + 2.7);
  // or pick a saved discussion
  cur.to(tl, 812, 140, T0 + 3.3, 0.6); cur.click(tl, T0 + 3.85, 812, 140); seg(2, T0 + 3.9);
  tl.to(['#s5-up', '#s5-file'], { opacity: 0, duration: 0.25 }, T0 + 3.9);
  tl.to('#s5-up', { color: 'rgba(0,0,0,0)', duration: 0.2 }, T0 + 2.75);
  tl.fromTo('#s5-disc', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out', immediateRender: false }, T0 + 4.0);
  // drafting
  tl.fromTo('#s5-read', { opacity: 0 }, { opacity: 1, duration: 0.2, immediateRender: false }, T0 + 4.9);
  tl.fromTo('#s5-spin', { rotate: 0 }, { rotate: 540, duration: 1.0, ease: 'none' }, T0 + 4.9);
  tl.to('#s5-read', { opacity: 0, duration: 0.2 }, T0 + 5.8);
  tl.set(list, { opacity: 1 }, T0 + 5.85);
  tl.fromTo(rows, { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.4, ease: 'expo.out', stagger: 0.1, immediateRender: false }, T0 + 5.85);
  // keep only what you want: untick the chairs
  cur.to(tl, 62, 466, T0 + 7.1, 0.7); cur.click(tl, T0 + 7.85, 62, 466);
  const k = panel.querySelectorAll('.s5-k')[3];
  tl.set(k, { attr: { class: 'kbox s5-k' } }, T0 + 7.9);
  tl.to(rows[3], { opacity: 0.45, duration: 0.25 }, T0 + 7.9);
  tl.set(panel.querySelector('.s5-n'), { textContent: '4' }, T0 + 7.95);
  cur.to(tl, 880, 662, T0 + 8.3, 0.65); cur.click(tl, T0 + 9.0, 880, 662);
  const toast = el(`<div class="toast" style="left:300px;top:600px;font-size:17px">${ic('checkCircle', 20)}4 tasks added to Planning</div>`, panel);
  tl.fromTo(toast, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.35, ease: 'back.out(1.6)' }, T0 + 9.1);
  sfx(T0 + 2.7, 'drop'); sfx(T0 + 5.85, 'pop'); sfx(T0 + 9.1, 'ding');
});
