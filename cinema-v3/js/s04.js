/* Roles, teams, positions, skills. VO v05 (≈ +0.4 → +10.6):
   "Give everyone a role: project manager, coordinator, member, QA, or stakeholder.
    Then build teams, with leads, positions, and the skills each person brings." */
(window.SCENES = window.SCENES || []).push(function (tl) {
  const b = beat(tl, { id: 's04', at: T.s04, dur: T.s05 - T.s04, eyebrow: 'Roles and teams', lines: ['Everyone knows', 'their <span class="amb">part.</span>'], sub: 'Roles, teams with leads, positions and skills.', w: 560 });
  const T0 = b.T0;

  const P = [
    ['AS', 'a', 'Angelica Santos', 'pm', 'Project manager', '', false, 'Planner', ['Planning']],
    ['JC', 'c', 'Joanna Cruz', 'co', 'Coordinator', 'Design', true, 'UI designer', ['Figma', 'UX writing']],
    ['MR', 'b', 'Miguel Reyes', '', 'Member', 'Development', false, 'Frontend developer', ['React', 'CSS']],
    ['RD', 'd', 'Rafael Dizon', '', 'Member', 'Development', true, 'Backend developer', ['SQL', 'APIs']],
    ['BL', 'e', 'Bea Lim', 'qa', 'QA', 'Quality', false, 'QA tester', ['Testing']],
    ['PG', 'f', 'Paolo Garcia', 'sh', 'Stakeholder', '', false, 'Client', []],
  ];
  const cols = '250px 172px 170px 196px 1fr';
  const row = (p, i) => `<div class="fp-row s4-row" style="display:grid;grid-template-columns:${cols};gap:14px;padding:13px 28px">
      <div style="display:flex;align-items:center;gap:12px;min-width:0">${av(p[0], p[1], 40)}<span style="font-size:17.5px;font-weight:600;white-space:nowrap">${p[2]}</span></div>
      <div><span class="role ${p[3]} s4-role">${p[4]}</span></div>
      <div class="s4-team" style="display:flex;align-items:center;gap:8px;font-size:16.5px;font-weight:600">${p[5] || '<span style="color:var(--ink-faint);font-weight:400">—</span>'}${p[6] ? '<span class="pill done s4-lead" style="height:24px">Lead</span>' : ''}</div>
      <div class="s4-pos" style="font-size:16px;color:var(--ink-muted);white-space:nowrap">${p[7]}</div>
      <div style="display:flex;gap:7px;flex-wrap:nowrap">${p[8].map((t) => `<span class="tag s4-tag">${t}</span>`).join('')}</div></div>`;

  const panel = prodPanel(b.stage, { cx: 1270, cy: 540, w: 1110, h: 500, html: `
    ${phead('users', 'Members & permissions', 'Public market app · 6 people', '<span class="btnp" style="height:40px;font-size:15px">' + ic('plus', 16) + 'Invite</span>')}
    <div style="display:grid;grid-template-columns:${cols};gap:14px;padding:16px 28px 8px" class="fp-h"><span>Person</span><span>Role</span><span>Team</span><span>Position</span><span>Skills</span></div>
    ${P.map(row).join('')}` });
  gsap.set(panel, { scale: 1.02 });
  panelIn(tl, panel, T0 + 0.25);

  const rows = panel.querySelectorAll('.s4-row');
  tl.fromTo(rows, { opacity: 0, x: 30 }, { opacity: 1, x: 0, duration: 0.45, ease: 'expo.out', stagger: 0.07 }, T0 + 0.8);
  // roles pop with the voice
  const roleAt = [1.85, 2.55, 3.2, 3.75, 4.3];
  const roles = panel.querySelectorAll('.s4-role');
  gsap.set(roles, { opacity: 0, scale: 0.5 });
  [0, 1, 2, 4, 5].forEach((ri, k) => popIn(tl, roles[ri], T0 + roleAt[k]));
  popIn(tl, roles[3], T0 + roleAt[2] + 0.15);
  // teams and leads, then positions
  const teams = panel.querySelectorAll('.s4-team'), leads = panel.querySelectorAll('.s4-lead'), pos = panel.querySelectorAll('.s4-pos');
  gsap.set([teams, pos], { opacity: 0 });
  tl.fromTo(teams, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.08, ease: 'power2.out', immediateRender: false }, T0 + 5.6);
  tl.fromTo(leads, { scale: 0.4 }, { scale: 1, duration: 0.4, ease: 'back.out(2)', stagger: 0.15, immediateRender: false }, T0 + 6.6);
  tl.fromTo(pos, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.08, ease: 'power2.out', immediateRender: false }, T0 + 7.3);
  // skills
  const tags = panel.querySelectorAll('.s4-tag');
  gsap.set(tags, { opacity: 0 });
  tl.fromTo(tags, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2)', stagger: 0.09, immediateRender: false }, T0 + 8.4);

  const co = callout(b.hud, { x: 1250, y: 830, w: 470, icon: 'target', eyebrow: 'Skills', title: 'Matched when work is assigned', accent: '#f0b429' });
  tl.to(co, { opacity: 1, z: 140, duration: 0.5, ease: 'expo.out' }, T0 + 9.2);
  tl.to(co, { opacity: 0, duration: 0.3 }, T0 + 11.2);
  sfx(T0 + 1.85, 'tick'); sfx(T0 + 5.6, 'pop'); sfx(T0 + 8.4, 'pop');
});
