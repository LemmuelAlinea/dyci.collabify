/* Project settings, as a camera move over the real Settings tab.
   VO v09a "Every project." +0.4  v09b "Your way." +1.93  v09c +3.17:
   "Set the stages, the task rules, priorities, subtasks, and dependencies. Then automate it: when this happens, do that." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const nav = ['General', 'Sprints', 'Tasks', 'Milestones', 'Members & permissions', 'Notifications', 'Workflow rules'];
  const STAGES = ['To do', 'Design', 'Build', 'Testing', 'Done'];
  const X = (i, n) => 70 + i * (1000 / (n - 1));
  const toggleRow = (id, t, help, on) => `<div class="rrow" id="${id}"><div style="flex:1"><div style="font-size:17px;font-weight:600">${t}</div><div style="font-size:14px;color:var(--ink-faint)">${help}</div></div><span class="tog ${on ? 'on' : ''}" style="width:56px;height:32px"><i style="width:26px;height:26px"></i></span></div>`;
  const chipC = (t, k) => `<span class="s8-c" style="display:inline-flex;align-items:center;height:46px;padding:0 18px;border-radius:12px;font-size:18px;font-weight:600;white-space:nowrap;${k ? 'background:var(--navy-700);color:#fff' : 'background:var(--surface-sunken);border:1px solid var(--line-strong)'}">${t}</span>`;

  const content = `
    <div style="display:flex;align-items:center;gap:16px;margin-top:4px"><span class="mk" style="background:#3d8bd9;width:50px;height:50px">P</span><div><div class="eyebrow" style="color:var(--ink-faint)">Lakbay Studio</div><h2 style="font-size:28px;line-height:1.1">Public market app</h2></div></div>
    ${tabs([['board', 'Overview'], ['message', 'Discussion'], ['kanban', 'Work'], ['folder', 'Files'], ['settings', 'Settings']], 'Settings')}
    <div style="display:grid;grid-template-columns:250px 1fr;gap:40px;margin-top:26px;align-items:start">
      <div id="s8-nav">${nav.map((n) => `<div class="s8-nav" style="height:44px;display:flex;align-items:center;padding:0 14px;border-radius:11px;font-size:15.5px;font-weight:600;color:var(--ink-muted)">${n}</div>`).join('')}</div>
      <div id="s8-body" style="position:relative;height:760px">
        <div id="s8-tasks" style="position:absolute;inset:0">
          <div id="s8-stephead"><h3 style="font-size:22px">Task workflow steps</h3><div style="font-size:14.5px;color:var(--ink-faint);margin-top:2px">Work moves through these, left to right.</div></div>
          <div id="s8-step" style="position:relative;width:1140px;height:84px;margin-top:30px">
            <div style="position:absolute;left:70px;width:1000px;top:13px;height:4px;border-radius:4px;background:var(--line-strong)"></div>
            <div id="s8-fill" style="position:absolute;left:70px;width:0;top:13px;height:4px;border-radius:4px;background:linear-gradient(90deg,var(--navy-600),#f0b429)"></div>
            ${STAGES.map((s, i) => `<div class="stp s8-st" style="left:${X(i, 5)}px"><span class="dot"><i></i></span><b>${s}</b></div>`).join('')}
            <div class="stp new" id="s8-new" style="left:${X(3, 6)}px"><span class="dot"><i></i></span><b>Review</b></div>
          </div>
          <h3 style="font-size:22px;margin-top:34px">Task rules</h3>
          <div id="s8-rules" style="margin-top:14px;width:780px">
            <div class="rrow" id="s8-pri"><div style="flex:1"><div style="font-size:17px;font-weight:600">Default priority</div><div style="font-size:14px;color:var(--ink-faint)">New tasks start at this priority.</div></div>
              <span class="sel2" id="s8-sel"><span class="pill prog" id="s8-pv" style="height:26px">Normal</span><span style="margin-left:auto">${ic('chevronDown', 16)}</span></span></div>
            ${toggleRow('s8-sub', 'Allow subtasks', 'One level deep, each with its own holder.', false)}
            ${toggleRow('s8-dep', 'Allow dependencies', 'A task can wait for the ones before it.', false)}
            ${toggleRow('s8-hold', 'Require a holder before work starts', 'Every task in progress has an owner.', true)}
          </div>
          <div id="s8-menu" style="position:absolute;left:0;top:0;width:200px;padding:6px;border-radius:14px;background:var(--surface);border:1px solid var(--line-strong);box-shadow:var(--shadow-lift);z-index:5">${[['Urgent', 'late'], ['High', 'late'], ['Normal', 'prog'], ['Low', 'pend']].map((p) => `<div class="s8-opt" style="padding:9px 10px;border-radius:9px"><span class="pill ${p[1]}">${p[0]}</span></div>`).join('')}</div>
        </div>
        <div id="s8-flow" style="position:absolute;inset:0">
          <div style="display:flex;align-items:baseline;gap:14px"><h3 style="font-size:22px">Workflow rules</h3><span class="mono" style="font-size:13px;color:var(--ink-faint)">1 of 20</span></div>
          <div id="s8-rule" style="position:relative;margin-top:22px;width:900px;padding:26px 28px;border:1px solid var(--line-strong);border-radius:20px;background:var(--surface);box-shadow:var(--shadow-card)">
            <div id="s8-when" style="display:flex;align-items:center;gap:12px">${chipC('When', 1)}${chipC('A task moves to a stage')}${chipC('Testing')}</div>
            <div id="s8-then" style="display:flex;align-items:center;gap:12px;margin-top:44px;padding-left:60px">${chipC('Then', 1)}${chipC('Notify')}${chipC('QA')}</div>
          </div>
        </div>
      </div>
    </div>`;
  const cut = shot(tl, { id: 's08', at: T.s08, dur: T.s09 - T.s08, eyebrow: 'Project settings', lines: ['Every project,', 'your <span class="amb">way.</span>'], lineAt: [0.35, 1.95], hold: 2.75, tag: 'Project settings', world: appWindow({ mode: 'work', active: 'Public market app', content }) });
  const T0 = cut.T0, w = cut.world;
  const q = (s) => w.querySelector(s);
  const navs = w.querySelectorAll('.s8-nav');
  const navOn = (i, at) => navs.forEach((n, j) => tl.set(n, { backgroundColor: i === j ? 'var(--surface-raised)' : 'rgba(0,0,0,0)', color: i === j ? 'var(--ink)' : 'var(--ink-muted)', boxShadow: i === j ? 'var(--shadow-card)' : 'none' }, at));
  navOn(2, T0);
  gsap.set(['#s8-flow', '#s8-menu'], { opacity: 0 });
  gsap.set(q('#s8-new'), { scale: 0, opacity: 0 });
  const sts = w.querySelectorAll('.s8-st');
  gsap.set(sts, { opacity: 0, y: 10 });
  const cur = cursor(w, 1500, 900);
  gsap.set(cur.el, { opacity: 0 });

  // in to the settings, then the steps
  cut.look(cut.rect(q('#s8-body').parentElement, 30), T0 + 2.75, 1.0);
  cut.look(cut.rect(q('#s8-step'), 60), T0 + 3.25, 0.85);
  tl.to('#s8-fill', { width: 1000, duration: 0.9, ease: 'power1.inOut' }, T0 + 3.35);
  sts.forEach((n, i) => tl.to(n, { opacity: 1, y: 0, duration: 0.3, ease: 'back.out(2)' }, T0 + 3.35 + i * 0.2));
  // a step slots in: the others make room, the line keeps flowing
  sts.forEach((n, i) => tl.to(n, { left: X(i < 3 ? i : i + 1, 6), duration: 0.5, ease: 'power3.inOut' }, T0 + 4.3));
  tl.to(q('#s8-new'), { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(2.2)' }, T0 + 4.55);
  cut.spot(q('#s8-new'), T0 + 4.6, 0.8, 8);

  // task rules: down to default priority, pick High
  cut.look(cut.rect(q('#s8-pri'), 30), T0 + 5.0, 0.8);
  const sel = cut.rect(q('#s8-sel'));
  cur.to(tl, sel.x + sel.w + 200, sel.y + 60, T0 + 5.0, 0.01);
  tl.to(cur.el, { opacity: 1, duration: 0.2 }, T0 + 5.1);
  cur.to(tl, sel.x + sel.w / 2, sel.y + sel.h / 2, T0 + 5.25, 0.45); cur.click(tl, T0 + 5.72, sel.x + sel.w / 2, sel.y + sel.h / 2);
  const menu = q('#s8-menu'), base = posIn(q('#s8-tasks'), w);
  gsap.set(menu, { left: sel.x - base.left, top: sel.y + sel.h + 6 - base.top });
  tl.fromTo(menu, { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.2, immediateRender: false }, T0 + 5.78);
  const hi = w.querySelectorAll('.s8-opt')[1];
  const hy = sel.y + sel.h + 6 + 6 + 45 + 22;
  cur.to(tl, sel.x + 50, hy, T0 + 5.9, 0.3); cur.click(tl, T0 + 6.22, sel.x + 50, hy);
  tl.to(hi, { backgroundColor: 'var(--surface-sunken)', duration: 0.1 }, T0 + 6.1);
  tl.to(menu, { opacity: 0, duration: 0.15 }, T0 + 6.3);
  tl.set(q('#s8-pv'), { textContent: 'High', attr: { class: 'pill late' } }, T0 + 6.3);

  // subtasks, dependencies: tight on each switch as it turns on
  const flip = (row, at) => {
    const t = row.querySelector('.tog'), k = t.firstElementChild, r = cut.rect(row, 0), tr = cut.rect(t, 0);
    cut.look({ x: r.x - 30, y: r.y - 40, w: r.w + 60, h: r.h + 80 }, at - 0.6, 0.55);
    cur.to(tl, tr.x + tr.w / 2, tr.y + tr.h / 2, at - 0.45, 0.4); cur.click(tl, at, tr.x + tr.w / 2, tr.y + tr.h / 2);
    tl.to(t, { backgroundColor: '#26327a', borderColor: '#26327a', duration: 0.18 }, at + 0.02);
    tl.to(k, { left: 27, duration: 0.24, ease: 'back.out(2)' }, at + 0.02);
    tl.fromTo(t, { boxShadow: '0 0 0 0 rgba(240,180,41,.7)' }, { boxShadow: '0 0 0 16px rgba(240,180,41,0)', duration: 0.55, immediateRender: false }, at + 0.05);
    sfx(at, 'tick');
  };
  flip(q('#s8-sub'), T0 + 7.0);
  flip(q('#s8-dep'), T0 + 7.75);

  // then automate it: back out to the menu, into workflow rules
  const nv = cut.rect(q('#s8-nav'), 0);
  cut.look({ x: nv.x - 40, y: nv.y - 60, w: 980, h: nv.h + 120 }, T0 + 8.15, 0.7);
  const wr = cut.rect(navs[6]);
  cur.to(tl, wr.x + 70, wr.y + wr.h / 2, T0 + 8.3, 0.5); cur.click(tl, T0 + 8.85, wr.x + 70, wr.y + wr.h / 2);
  navOn(6, T0 + 8.9);
  tl.to('#s8-tasks', { opacity: 0, x: -30, duration: 0.25 }, T0 + 8.9);
  tl.fromTo('#s8-flow', { opacity: 0, x: 30 }, { opacity: 1, x: 0, duration: 0.35, immediateRender: false }, T0 + 9.0);
  tl.to(cur.el, { opacity: 0, duration: 0.2 }, T0 + 9.1);
  cut.look(cut.rect(q('#s8-rule'), 40), T0 + 9.05, 0.75);
  const c1 = w.querySelectorAll('#s8-when .s8-c'), c2 = w.querySelectorAll('#s8-then .s8-c');
  gsap.set([c1, c2], { opacity: 0 });
  tl.fromTo(c1, { opacity: 0, y: 14, scale: 0.7 }, { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: 'back.out(2)', stagger: 0.22, immediateRender: false }, T0 + 9.4);
  const svg = wireLayer(cut);
  wire(tl, svg, cut, c1[0], c2[0], T0 + 10.05, '#f0b429', 0.45, true);
  tl.fromTo(c2, { opacity: 0, y: 14, scale: 0.7 }, { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: 'back.out(2)', stagger: 0.2, immediateRender: false }, T0 + 10.35);
  cut.look(cut.rect(q('#s8-rule'), 90), T0 + 10.9, 1.1, { ease: 'sine.inOut' });
  sfx(T0 + 3.35, 'rise'); sfx(T0 + 4.55, 'pop'); sfx(T0 + 5.72, 'click'); sfx(T0 + 9.4, 'pop');
});
