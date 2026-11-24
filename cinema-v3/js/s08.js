/* Project settings. VO v09 (≈ +0.4 → +9.6):
   "Every project, your way. Set the stages, the task rules, priorities, subtasks, and dependencies.
    Then automate it: when this happens, do that." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const b = beat(tl, { id: 's08', at: T.s08, dur: T.s09 - T.s08, eyebrow: 'Project settings', lines: ['Every project,', 'your <span class="amb">way.</span>'], sub: 'Stages, task rules and automations you set.', w: 520 });
  const T0 = b.T0;

  const nav = ['General', 'Sprints', 'Tasks', 'Milestones', 'Members & permissions', 'Notifications', 'Workflow rules'];
  const stg = (t, cls = '') => `<span class="stage ${cls}" style="height:38px;padding:0 12px;font-size:15px">${t}</span>`;
  const arrow = `<span style="color:var(--ink-faint);display:grid">${ic("arrowRight", 15)}</span>`;
  const toggles = [['Allow subtasks', 'One level deep, with their own holders'], ['Allow dependencies', 'A task waits for the ones before it'], ['Use priority', 'Urgent, High, Normal and Low'], ['Require a holder before work starts', 'No unowned work in progress']];
  const chipC = (t, k) => `<span class="s8-c" style="display:inline-flex;align-items:center;height:42px;padding:0 16px;border-radius:12px;font-size:17px;font-weight:600;white-space:nowrap;${k === 'k' ? 'background:var(--navy-700);color:#fff' : 'background:var(--surface-sunken);border:1px solid var(--line-strong)'}">${t}</span>`;
  const rule = (id, when, what, then, to) => `<div id="${id}" style="padding:20px 22px;border:1px solid var(--line-strong);border-radius:18px;background:var(--surface);box-shadow:var(--shadow-card);margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">${chipC('When', 'k')}${chipC(when)}${what ? chipC(what) : ''}</div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:12px;padding-left:28px">${ic('arrowRight', 20)}${chipC('Then', 'k')}${chipC(then)}${chipC(to)}</div></div>`;

  const panel = prodPanel(b.stage, { cx: 1290, cy: 545, w: 1100, h: 570, html: `
    <div style="display:grid;grid-template-columns:250px 1fr;height:100%">
      <div style="border-right:1px solid var(--line);padding:24px 14px;background:var(--surface-sunken)">
        <div class="fp-h" style="padding:0 12px 12px">Settings</div>
        ${nav.map((n, i) => `<div class="s8-nav" data-i="${i}" style="height:44px;display:flex;align-items:center;padding:0 14px;border-radius:11px;font-size:16.5px;font-weight:600;color:var(--ink-muted);white-space:nowrap">${n}</div>`).join('')}
      </div>
      <div style="position:relative">
        <div id="s8-tasks" style="position:absolute;inset:0;padding:28px 32px">
          <div class="disp" style="font-size:28px;font-weight:700">Tasks</div>
          <div class="fp-h" style="margin:22px 0 12px">Stages</div>
          <div id="s8-stages" style="display:flex;align-items:center;gap:8px">${stg('To do')}${arrow}${stg('Design')}${arrow}${stg('Build')}<span id="s8-ins" style="display:inline-flex;align-items:center;gap:8px;overflow:hidden;width:0">${arrow}${stg('Review', 's8-new')}</span>${arrow}${stg('Testing')}${arrow}${stg('Done')}</div>
          <div class="fp-h" style="margin:30px 0 4px">Task rules</div>
          ${toggles.map((t) => `<div style="display:flex;align-items:center;gap:16px;padding:14px 0;border-bottom:1px solid var(--line)"><div style="flex:1"><div style="font-size:18px;font-weight:600">${t[0]}</div><div style="font-size:14.5px;color:var(--ink-faint)">${t[1]}</div></div><span class="tog s8-tog"><i></i></span></div>`).join('')}
        </div>
        <div id="s8-flow" style="position:absolute;inset:0;padding:28px 32px">
          <div style="display:flex;align-items:baseline;gap:14px"><span class="disp" style="font-size:28px;font-weight:700">Workflow rules</span><span class="mono" style="font-size:14px;color:var(--ink-faint)">2 of 20</span></div>
          <div style="margin-top:22px">${rule('s8-r1', 'A task moves to a stage', 'Testing', 'Notify', 'QA')}${rule('s8-r2', 'A task becomes overdue', '', 'Set the priority to', 'Urgent')}</div>
        </div>
      </div>
    </div>` });
  gsap.set(panel, { scale: 1.02 });
  panelIn(tl, panel, T0 + 0.25);

  const navs = panel.querySelectorAll('.s8-nav');
  const navOn = (i, at) => navs.forEach((n, j) => tl.set(n, { backgroundColor: i === j ? 'var(--surface)' : 'rgba(0,0,0,0)', color: i === j ? 'var(--ink)' : 'var(--ink-muted)', boxShadow: i === j ? 'var(--shadow-card)' : 'none' }, at));
  navOn(2, T0); gsap.set('#s8-flow', { opacity: 0 });

  // stages: Review slots in
  tl.to("#s8-ins", { width: 112, duration: 0.55, ease: 'expo.out' }, T0 + 2.2);
  tl.fromTo(panel.querySelector('.s8-new'), { backgroundColor: '#fdebbf', borderColor: '#f0b429' }, { backgroundColor: '#fdebbf', borderColor: '#f0b429', duration: 0.01 }, T0 + 2.2);
  // task rules switch on with the voice
  panel.querySelectorAll('.s8-tog').forEach((t, i) => {
    const at = T0 + [3.3, 4.6, 4.05, 5.6][i];
    tl.set(t, { attr: { class: 'tog s8-tog on' } }, at);
    tl.fromTo(t.firstElementChild, { left: 3 }, { left: 22, duration: 0.22, ease: 'power2.out', immediateRender: false }, at);
  });
  // then automate it
  navOn(6, T0 + 6.4);
  tl.to('#s8-tasks', { opacity: 0, x: -20, duration: 0.3 }, T0 + 6.4);
  tl.fromTo('#s8-flow', { opacity: 0, x: 20 }, { opacity: 1, x: 0, duration: 0.4, ease: 'power2.out', immediateRender: false }, T0 + 6.5);
  const c1 = panel.querySelectorAll('#s8-r1 .s8-c'), c2 = panel.querySelectorAll('#s8-r2 .s8-c');
  gsap.set([c1, c2], { opacity: 0 });
  tl.fromTo(c1, { opacity: 0, scale: 0.6, y: 10 }, { opacity: 1, scale: 1, y: 0, duration: 0.32, ease: 'back.out(2)', stagger: 0.24, immediateRender: false }, T0 + 6.9);
  tl.fromTo(c2, { opacity: 0, scale: 0.6, y: 10 }, { opacity: 1, scale: 1, y: 0, duration: 0.32, ease: 'back.out(2)', stagger: 0.2, immediateRender: false }, T0 + 8.8);
  sfx(T0 + 2.2, 'pop'); [3.3, 4.05, 4.6, 5.6].forEach((t) => sfx(T0 + t, 'tick')); sfx(T0 + 6.9, 'pop');
});
