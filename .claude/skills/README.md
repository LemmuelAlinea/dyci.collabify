# Vendored agent skills

Copied from upstream so they load in every session, including fresh cloud containers.
Update by re-copying from the pinned commit's repo.

| Source | Commit | What's here | License |
|---|---|---|---|
| [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) | `2fd153c` | `caveman`, `caveman-commit`, `caveman-review`, `caveman-compress`, `caveman-help`, `cavecrew` + `../agents/cavecrew-*.md` | MIT (`skills/`) |
| [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | `e3ba2aa` | `ponytail`, `ponytail-review`, `ponytail-audit`, `ponytail-debt`, `ponytail-help`, `ponytail-gain` | MIT |
| [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) | `ba3c21e` (CLI 1.6.0) | Not a skill: MCP server in `/.mcp.json`, reinstalled by `../hooks/session-start.sh` | MIT |

Left out on purpose:

- Caveman and ponytail plugin hooks that switch the mode on for every session. Both are
  opt-in here: run `/caveman` or `/ponytail` when wanted.
- `caveman-setup` — routes the app's LLM calls through a third-party gateway. Syllabus
  text is student/professor data under RA 10173; it doesn't go through extra processors.
- `caveman-stats`, `caveman-learn`, `caveman-discover`, `caveman-manage`,
  `caveman-optimize` — need the caveman CLI, engine or hooks.
- CodeGraph telemetry is off (`CODEGRAPH_TELEMETRY=0`).
