/* Roles, teams, positions, skills. VO v05 (+0.4 → +10.6): "Give everyone a role: project manager, coordinator,
   member, QA, or stakeholder. Then build teams, with leads, positions, and the skills each person brings." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const P = [
    ['AS', 'a', 'Angelica Santos', 'pm', 'Project manager', '', false, 'Planner', ['Planning', 'Budget']],
    ['JC', 'c', 'Joanna Cruz', 'co', 'Coordinator', 'Design', true, 'UI designer', ['Figma', 'UX writing']],
    ['MR', 'b', 'Miguel Reyes', '', 'Member', 'Development', false, 'Frontend developer', ['React', 'CSS']],
    ['RD', 'd', 'Rafael Dizon', '', 'Member', 'Development', true, 'Backend developer', ['SQL', 'APIs']],
    ['BL', 'e', 'Bea Lim', 'qa', 'QA', 'Quality', false, 'QA tester', ['Testing']],
    ['PG', 'f', 'Paolo Garcia', 'sh', 'Stakeholder', '', false, 'Client', []],
  ];
  const cols = '290px 200px 230px 230px 1fr';
  const row = (p) => `<div class="s4-row" style="display:grid;grid-template-columns:${cols};gap:16px;align-items:center;padding:16px 24px;border-top:1px solid var(--line)">
      <div style="display:flex;align-items:center;gap:14px">${av(p[0], p[1], 42)}<span style="font-size:17px;font-weight:600">${p[2]}</span></div>
      <div class="s4-rc"><span class="role ${p[3]} s4-role">${p[4]}</span></div>
      <div class="s4-tc" style="display:flex;align-items:center;gap:8px;font-size:16px;font-weight:600"><span class="s4-team">${p[5] || '<span style="color:var(--ink-faint);font-weight:400">—</span>'}</span>${p[6] ? '<span class="pill done s4-lead">Lead</span>' : ''}</div>
      <div class="s4-pc" style="font-size:16px;color:var(--ink-muted);white-space:nowrap"><span class="s4-pos"></span></div>
      <div class="s4-sc" style="display:flex;gap:8px">${p[8].map((t) => `<span class="tag s4-tag">${t}</span>`).join('')}</div></div>`;
  const content = `
    <div style="display:flex;align-items:center;gap:16px;margin-top:4px"><span class="mk" style="background:#3d8bd9;width:50px;height:50px">P</span><div><div class="eyebrow" style="color:var(--ink-faint)">Lakbay Studio</div><h2 style="font-size:28px;line-height:1.1">Public market app</h2></div></div>
    ${tabs([['board', 'Overview'], ['message', 'Discussion'], ['kanban', 'Work'], ['folder', 'Files'], ['settings', 'Settings']], 'Settings')}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:24px"><div><h3 style="font-size:22px">Members & permissions</h3><div style="font-size:14.5px;color:var(--ink-faint)">6 people · 3 teams</div></div><span class="btnp">${ic('plus', 16)}Invite</span></div>
    <div id="s4-table" class="card" style="margin-top:16px;overflow:hidden">
      <div class="fp-h" style="display:grid;grid-template-columns:${cols};gap:16px;padding:14px 24px"><span>Person</span><span id="s4-hr">Role</span><span id="s4-ht">Team</span><span id="s4-hp">Position</span><span id="s4-hs">Skills</span></div>
      ${P.map(row).join('')}</div>`;
  const cut = shot(tl, { id: 's04', at: T.s04, dur: T.s05 - T.s04, eyebrow: 'Roles and teams', lines: ['Everyone knows', 'their <span class="amb">part.</span>'], hold: 1.4, tag: 'Roles, teams and skills', world: appWindow({ mode: 'work', active: 'Public market app', content }) });
  const T0 = cut.T0, w = cut.world, q = (s) => w.querySelector(s), all = (s) => [...w.querySelectorAll(s)];
  const rows = all('.s4-row'), roles = all('.s4-role'), teams = all('.s4-team'), leads = all('.s4-lead'), poss = all('.s4-pos'), tags = all('.s4-tag');
  gsap.set(roles, { opacity: 0, scale: 0.4 }); gsap.set(teams, { opacity: 0 }); gsap.set(leads, { opacity: 0, scale: 0.3 }); gsap.set(tags, { opacity: 0, scale: 0.5 });
  const col = (cls, padX = 30) => { const a = cut.rect(q('#' + cls), 0), b = cut.rect(rows[rows.length - 1], 0); return { x: a.x - padX, y: a.y - 30, w: 0, h: b.y + b.h - a.y + 60 }; };
  const band = (head, width) => { const r = col(head); r.w = width; r.x -= 300; r.w += 330; return r; };

  cut.lookAt(q('#s4-table'), T0 + 1.4, 0.8, { pad: 30 });
  // roles: the camera rides down the role column as each one lands
  const roleAt = [1.85, 2.5, 3.15, 3.35, 3.75, 4.3];
  const order = [0, 1, 2, 3, 4, 5];
  cut.look(band('s4-hr', 230), T0 + 1.75, 0.7);
  order.forEach((i, k) => { tl.to(roles[i], { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2.4)' }, T0 + roleAt[k]); sfx(T0 + roleAt[k], 'tick'); });
  roles.forEach((r, i) => tl.fromTo(r, { boxShadow: '0 0 0 0 rgba(240,180,41,.7)' }, { boxShadow: '0 0 0 12px rgba(240,180,41,0)', duration: 0.5, immediateRender: false }, T0 + roleAt[i] + 0.05));
  // teams and leads
  cut.look(band('s4-ht', 260), T0 + 5.1, 0.7);
  tl.to(teams, { opacity: 1, duration: 0.3, stagger: 0.1 }, T0 + 5.45);
  tl.to(leads, { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2.5)', stagger: 0.18 }, T0 + 6.45);
  leads.forEach((l, i) => cut.spot(l, T0 + 6.5 + i * 0.18, 0.6, 6));
  // positions, typed in
  cut.look(band('s4-hp', 260), T0 + 6.95, 0.6);
  poss.forEach((n, i) => type(tl, n, P[i][7], T0 + 7.15 + i * 0.12, 60));
  // skills
  cut.look(band('s4-hs', 420), T0 + 7.75, 0.65);
  tl.to(tags, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(2.2)', stagger: 0.09 }, T0 + 8.0);
  // the whole table, everyone placed
  cut.lookAt(q('#s4-table'), T0 + 9.6, 1.4, { pad: 40, ease: 'sine.inOut' });
  sfx(T0 + 5.45, 'pop'); sfx(T0 + 8.0, 'pop');
});
