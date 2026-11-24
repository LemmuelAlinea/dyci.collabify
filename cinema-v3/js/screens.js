/* Content builders for the screens the film visits. Labels are the product's own. */
(function () {
  const W = window;
  W.S = {};

  const stat = (icon, n, l) => `<div style="flex:1;border:1px solid color-mix(in oklab,var(--banner-ink) 22%,transparent);border-radius:14px;padding:16px 18px;background:color-mix(in oklab,var(--banner) 80%,transparent)">
      <div style="color:var(--banner-accent)">${ic(icon, 20)}</div><div class="disp" style="font-size:34px;font-weight:700;line-height:1.1;margin-top:8px">${n}</div><div style="font-size:13px;opacity:.7">${l}</div></div>`;

  const taskRow = (t, who, due, pill, cls) => `<div style="display:flex;align-items:center;gap:14px;padding:14px 18px;border-top:1px solid var(--line)">
      <span style="width:20px;height:20px;border-radius:6px;border:1.5px solid var(--line-strong);flex:none"></span>
      <div style="flex:1"><div style="font-size:15px;font-weight:600">${t}</div><div style="font-size:12.5px;color:var(--ink-faint)">${who}</div></div>
      <span class="mono" style="font-size:12px;color:var(--ink-muted)">${due}</span><span class="pill ${cls}">${pill}</span></div>`;

  const projRow = (ini, name, meta, pct) => `<div style="display:flex;gap:14px;padding:16px 18px;border-top:1px solid var(--line);align-items:center">
      <div class="tile" style="width:44px;height:44px;font-weight:800;font-family:var(--font-display)">${ini}</div>
      <div style="flex:1"><div style="font-size:15.5px;font-weight:600">${name}</div><div style="font-size:12.5px;color:var(--ink-faint);margin:2px 0 8px">${meta}</div><div class="pbar"><i style="width:${pct}%"></i></div></div>
      <span class="mono" style="font-size:13px;color:var(--ink-muted)">${pct}%</span></div>`;

  S.home = (o = {}) => `
    ${banner({ tag: 'Student', title: `Good morning, <em>${o.name || 'Angelica'}</em>.`, sub: '3 tasks are due this week. Your group is 62% done.',
      extra: `<div style="display:flex;gap:14px;margin-top:22px">${stat('check', 3, 'Due this week')}${stat('clock', 5, 'In progress')}${stat('board', 2, 'Projects')}${stat('upload', 1, 'Hand-in open')}</div>` })}
    <div style="display:grid;grid-template-columns:1.15fr 1fr;gap:22px;margin-top:26px">
      <div class="card"><div style="display:flex;align-items:center;gap:10px;padding:18px 18px 14px;font-weight:700;font-family:var(--font-display);font-size:18px">${ic('checkCircle', 20)}My tasks<span class="cnt">5</span></div>
        ${taskRow('Draft the interview questions', 'Barangay health portal', 'Oct 11', 'Late', 'late')}
        ${taskRow('Design the patient record screen', 'Barangay health portal', 'Oct 14', 'In progress', 'prog')}
        ${taskRow('Write the data dictionary', 'Capstone proposal', 'Oct 16', 'Pending', 'pend')}
        ${taskRow('Test the sign-in flow', 'Barangay health portal', 'Oct 9', 'Done', 'done')}</div>
      <div class="card"><div style="display:flex;align-items:center;gap:10px;padding:18px 18px 14px;font-weight:700;font-family:var(--font-display);font-size:18px">${ic('kanban', 20)}Your projects<span class="cnt">2</span></div>
        ${projRow('B', 'Barangay health portal', 'Systems Analysis and Design · Group 3', 62)}
        ${projRow('C', 'Capstone proposal', 'Research methods · Solo', 38)}</div>
    </div>
    <div style="display:grid;grid-template-columns:1.15fr 1fr;gap:22px;margin-top:22px">
      <div class="card"><div style="display:flex;align-items:center;gap:10px;padding:18px 18px 10px;font-weight:700;font-family:var(--font-display);font-size:18px">${ic('calendar', 20)}Coming up</div>
        ${[['Oct 11', 'Interview questions due', 'late'], ['Oct 14', 'Patient record screen due', 'prog'], ['Oct 20', 'Project Milestone 2 hand-in', 'pend']].map((r) => `<div style="display:flex;align-items:center;gap:14px;padding:12px 18px;border-top:1px solid var(--line)"><span class="mono" style="font-size:12.5px;width:58px;color:var(--ink-muted)">${r[0]}</span><span style="flex:1;font-size:15px;font-weight:600">${r[1]}</span><span class="pill ${r[2]}">${{ late: 'Soon', prog: 'This week', pend: 'Next week' }[r[2]]}</span></div>`).join('')}</div>
      <div class="card"><div style="display:flex;align-items:center;gap:10px;padding:18px 18px 10px;font-weight:700;font-family:var(--font-display);font-size:18px">${ic('message', 20)}Group 3 discussion</div>
        <div style="padding:6px 18px 16px;font-size:14.5px;color:var(--ink-muted);line-height:1.5"><b style="color:var(--ink)">Joanna:</b> Ok team, who takes the patient records screen?<br><b style="color:var(--ink)">Miguel:</b> I can design it. I need the data dictionary first.</div></div>
    </div>`;
})();
