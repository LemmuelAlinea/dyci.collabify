// Places every voice-over line on the film's clock and checks it fits its beat.
// Reads audio/vo/script.json ([{ id, scene, text, at? }]), each audio/vo/<id>.wav and timings.json.
// A line starts at its scene's start + `at` (default 0.4 s for a scene's first line), or 0.25 s
// after the line before it in the same scene. It must end 0.6 s before the next scene starts.
// Writes audio/vo/cues.json ([{ id, start, end, text }]) for the mix and the captions.
// Exits 1 on any line that does not fit, a missing wav, or a film longer than 150 s.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const T = JSON.parse(readFileSync(join(root, 'timings.json'), 'utf8'));
const lines = JSON.parse(readFileSync(join(root, 'audio/vo/script.json'), 'utf8'));
const ids = Object.keys(T).filter((k) => k !== 'end');
const nextStart = (s) => { const i = ids.indexOf(s); return i + 1 < ids.length ? T[ids[i + 1]] : T.end; };

export function wavSeconds(file) {
  const b = readFileSync(file);
  let p = 12, rate = 0, block = 0;
  while (p < b.length - 8) {
    const id = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') { rate = b.readUInt32LE(p + 8 + 4); block = b.readUInt16LE(p + 8 + 12); }
    if (id === 'data') return size / block / rate;
    p += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${file}`);
}

const errors = [];
if (T.end > 150) errors.push(`total ${T.end} s exceeds 150`);
const cues = [];
let prev = null;
for (const l of lines) {
  if (!(l.scene in T)) { errors.push(`${l.id}: unknown scene ${l.scene}`); continue; }
  const wav = join(root, 'audio/vo', `${l.id}.wav`);
  if (!existsSync(wav)) { errors.push(`${l.id}: missing ${l.id}.wav`); continue; }
  const d = wavSeconds(wav);
  const start = l.at != null ? T[l.scene] + l.at : prev && prev.scene === l.scene ? prev.end + 0.25 : T[l.scene] + 0.4;
  const end = start + d;
  const limit = nextStart(l.scene) - 0.6;
  if (end > limit) errors.push(`${l.id} (${l.scene}): ends ${end.toFixed(2)} s, beat allows ${limit.toFixed(2)} s (over by ${(end - limit).toFixed(2)} s)`);
  cues.push({ id: l.id, start: +start.toFixed(3), end: +end.toFixed(3), text: l.text });
  prev = { scene: l.scene, end };
}
writeFileSync(join(root, 'audio/vo/cues.json'), JSON.stringify(cues, null, 1));
for (const c of cues) console.log(`${c.id}  ${c.start.toFixed(2)}–${c.end.toFixed(2)}  ${c.text}`);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`ok: ${cues.length} lines, total ${T.end} s`);
