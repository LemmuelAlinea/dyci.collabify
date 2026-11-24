"""Captions from the voice-over cues (audio/vo/cues.json, written by tools/check-timing.mjs).
A line longer than 84 characters is split at its sentence breaks, with time shared by length.
Writes captions.srt and captions.vtt next to index.html."""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cues = json.load(open(os.path.join(ROOT, 'audio', 'vo', 'cues.json'), encoding='utf-8'))


def parts(text):
    if len(text) <= 84:
        return [text]
    bits = [b.strip() for b in re.split(r'(?<=[.?!:])\s+', text) if b.strip()]
    out, cur = [], ''
    for b in bits:
        if cur and len(cur) + 1 + len(b) > 84:
            out.append(cur)
            cur = b
        else:
            cur = (cur + ' ' + b).strip()
    out.append(cur)
    return out


rows = []
for c in cues:
    ps = parts(c['text'])
    total = sum(len(p) for p in ps)
    t = c['start']
    for p in ps:
        d = (c['end'] - c['start']) * len(p) / total
        rows.append((t, t + d, p))
        t += d


def stamp(t, sep):
    h, r = divmod(t, 3600)
    m, s = divmod(r, 60)
    return '%02d:%02d:%02d%s%03d' % (h, m, int(s), sep, round((s - int(s)) * 1000) % 1000)


srt = '\n'.join('%d\n%s --> %s\n%s\n' % (i + 1, stamp(a, ','), stamp(b, ','), t) for i, (a, b, t) in enumerate(rows))
vtt = 'WEBVTT\n\n' + '\n'.join('%s --> %s\n%s\n' % (stamp(a, '.'), stamp(b, '.'), t) for a, b, t in rows)
open(os.path.join(ROOT, 'captions.srt'), 'w', encoding='utf-8').write(srt)
open(os.path.join(ROOT, 'captions.vtt'), 'w', encoding='utf-8').write(vtt)
print('captions', len(rows))
