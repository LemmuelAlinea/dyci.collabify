"""Score, sound design and voiceover mix for the Collabify launch film v3.
120 bpm, 48 kHz stereo. Beats come from timings.json, voice from audio/vo/cues.json,
sound effects from the seconds the scenes log (audio/events.json, written by tools/events.mjs)."""
import json, os, wave
import numpy as np
from scipy import signal

SR = 48000
HERE0 = os.path.dirname(os.path.abspath(__file__))
TM = json.load(open(os.path.join(HERE0, '..', 'timings.json')))
DUR = float(TM['end'])
ACT1, DRUMS, EDU, CLOSE = TM['s01'], TM['s03'], TM['s10'], TM['s15']
LOGO = CLOSE - 0.45 + 1.25
N = int(SR * (DUR + 1.5))
HERE = os.path.dirname(os.path.abspath(__file__))
rs = np.random.RandomState(7)


def t_(n):
    return np.arange(n) / SR


def env_adsr(n, a, d, s, r):
    e = np.ones(n)
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    e[:na] = np.linspace(0, 1, max(na, 1))
    e[na:na + nd] = np.linspace(1, s, max(nd, 1))[: max(0, min(nd, n - na))]
    e[na + nd:] = s
    if nr > 0 and nr < n:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


def add(buf, snd, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= buf.shape[1] or i + len(snd) <= 0:
        return
    if i < 0:
        snd = snd[-i:]
        i = 0
    snd = snd[: buf.shape[1] - i]
    l = np.cos((pan + 1) * np.pi / 4)
    r = np.sin((pan + 1) * np.pi / 4)
    buf[0, i:i + len(snd)] += snd * gain * l
    buf[1, i:i + len(snd)] += snd * gain * r


def lp(x, fc, order=2):
    b, a = signal.butter(order, fc / (SR / 2), 'low')
    return signal.lfilter(b, a, x)


def hp(x, fc, order=2):
    b, a = signal.butter(order, fc / (SR / 2), 'high')
    return signal.lfilter(b, a, x)


def bp(x, f1, f2, order=2):
    b, a = signal.butter(order, [f1 / (SR / 2), f2 / (SR / 2)], 'band')
    return signal.lfilter(b, a, x)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def reverb(x, secs=1.6, wet=0.3, seed=3):
    r = np.random.RandomState(seed)
    n = int(secs * SR)
    ir = r.randn(n) * np.exp(-np.linspace(0, 6.5, n))
    ir = lp(ir, 5500)
    ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
    out = np.stack([signal.fftconvolve(x[0], ir)[: x.shape[1]], signal.fftconvolve(x[1], ir[::-1])[: x.shape[1]]])
    out /= np.max(np.abs(out)) + 1e-9
    return x * (1 - wet) + out * wet * np.max(np.abs(x))


# ---------------------------------------------------------------- music
music = np.zeros((2, N))
pad = np.zeros((2, N))
BEAT = 0.5
CH = [  # root midi, chord tones midi
    (45, [57, 60, 64, 67, 71]),   # Am9
    (41, [53, 57, 60, 64]),       # Fmaj7
    (48, [60, 64, 67, 71]),       # Cmaj7
    (43, [55, 59, 62, 64, 69]),   # G6/9
]


def pad_note(m, dur, detune=0.0):
    n = int((dur + 0.8) * SR)
    t = t_(n)
    f = midi(m) * 2 ** (detune / 1200)
    x = np.zeros(n)
    for h in range(1, 9):
        x += np.sin(2 * np.pi * f * h * t + h) / (h ** 1.3)
    x *= env_adsr(n, 0.7, 0.4, 0.8, 0.8)
    return x * 0.5


bar = 2.0
chord_len = 2.0
for k in range(int(DUR / chord_len) + 1):
    t0 = k * chord_len
    root, tones = CH[k % 4]
    # intro is thin, then it fills in
    gain = 0.45 if t0 < ACT1 else 0.75
    if t0 >= CLOSE:
        gain = 0.95
    for j, m in enumerate(tones):
        for dt, pn in ((-6, -0.5), (6, 0.5)):
            add(pad, pad_note(m, chord_len + 0.3, dt), t0, gain * 0.16, pn * 0.8)
pad = lp(pad, 3200, 2)
pad = reverb(pad, 2.2, 0.35, 5)
music += pad * 0.9

# bass: root pulse from 7 s
def bass_note(m, dur):
    n = int(dur * SR)
    t = t_(n)
    f = midi(m)
    x = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t)
    return x * env_adsr(n, 0.005, 0.12, 0.6, 0.06)


for k in range(int(DUR / chord_len) + 1):
    t0 = k * chord_len
    if t0 < ACT1 or LOGO - 0.4 <= t0 < LOGO + 0.6:
        continue
    root = CH[k % 4][0] - 12
    for b_ in (0, 1.5, 2.5, 3):
        add(music, bass_note(root, 0.42), t0 + b_ * BEAT * 1.0, 0.33)

# pluck arpeggio
def pluck(m, dur=0.3):
    n = int(dur * SR)
    t = t_(n)
    f = midi(m)
    x = np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * np.sin(2 * np.pi * 3 * f * t)
    return x * np.exp(-t * 11)


arp = np.zeros((2, N))
for k in range(int(DUR / chord_len) + 1):
    t0 = k * chord_len
    tones = CH[k % 4][1]
    if t0 < 4:
        step = 1.0 * BEAT * 2
        vol = 0.08
    elif t0 < ACT1:
        step = BEAT
        vol = 0.11
    elif t0 < DRUMS:
        step = BEAT / 2
        vol = 0.13
    elif t0 < CLOSE:
        step = BEAT / 4 * 1.0 if (int(t0) % 4 == 0) else BEAT / 2
        vol = 0.12
    else:
        step = BEAT * 2
        vol = 0.11
    i = 0
    tt = t0
    while tt < t0 + chord_len - 1e-6:
        m = tones[[0, 2, 1, 3, 2, 4 % len(tones), 1, 3][i % 8] % len(tones)] + (12 if (i % 4 == 3) else 12)
        add(arp, pluck(m + 0, 0.35), tt, vol, ((-1) ** i) * 0.45)
        i += 1
        tt += step
arp = reverb(arp, 1.3, 0.28, 9)
music += arp

# drums
def kick():
    n = int(0.38 * SR)
    t = t_(n)
    f = 46 + 90 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 9) * 1.0


def hat(open_=False):
    n = int((0.22 if open_ else 0.05) * SR)
    x = hp(rs.randn(n), 7000)
    return x * np.exp(-t_(n) * (22 if open_ else 90)) * 0.5


def clap():
    n = int(0.22 * SR)
    x = bp(rs.randn(n), 1200, 5500)
    e = np.exp(-t_(n) * 20)
    for off in (0.0, 0.011, 0.022):
        e[int(off * SR):] += 0.6 * np.exp(-t_(n - int(off * SR)) * 40)
    return x * e * 0.5


KICKS = []
for bi in range(int(DUR / BEAT)):
    tt = bi * BEAT
    if ACT1 <= tt < CLOSE and not (EDU - 0.5 <= tt < EDU):
        add(music, kick(), tt, 0.62 if tt >= DRUMS else 0.42)
        KICKS.append(tt)
    if TM['s02'] <= tt < CLOSE and bi % 2 == 1:
        add(music, hat(), tt + 0.0, 0.16 if tt < DRUMS else 0.22, 0.3)
    if DRUMS <= tt < CLOSE and bi % 4 in (1, 3) and not (EDU - 1.0 <= tt < EDU):
        add(music, clap(), tt, 0.28)
    if DRUMS <= tt < CLOSE:
        add(music, hat(), tt + BEAT / 2, 0.12, -0.3)

# risers into every act
def riser(dur, lo=300, hi=7000):
    n = int(dur * SR)
    t = t_(n)
    x = rs.randn(n)
    # sweep via time-varying filter by mixing bands
    out = np.zeros(n)
    segs = 24
    for s in range(segs):
        a, b = s * n // segs, (s + 1) * n // segs
        fc = lo * (hi / lo) ** (s / segs)
        out[a:b] = bp(x, fc * 0.7, min(fc * 1.4, 20000))[a:b]
    out *= np.linspace(0, 1, n) ** 2.2
    sw = np.sin(2 * np.pi * np.cumsum(200 + 1400 * (t / dur) ** 2) / SR) * (t / dur) ** 2 * 0.35
    return (out * 0.5 + sw)


for t0, d in ((ACT1 - 2.2, 2.2), (DRUMS - 2.4, 2.4), (EDU - 2.2, 2.2), (CLOSE - 2.0, 2.0)):
    add(music, riser(d), t0, 0.22)

# sidechain-ish gentle pump on the whole bed so the kick breathes
pump = np.ones(N)
for kt in KICKS:
    i = int(kt * SR)
    L = int(0.30 * SR)
    pump[i:i + L] *= 1 - 0.22 * np.exp(-np.linspace(0, 6, min(L, N - i)))
music *= pump

# drop the bed at the logo: silence for a beat, then the impact
def fade_region(x, a, b, g):
    ia, ib = int(a * SR), int(b * SR)
    x[:, ia:ib] *= g

fade_region(music, LOGO - 0.4, LOGO + 0.1, 0.0)

# ---------------------------------------------------------------- sfx
sfx = np.zeros((2, N))


def click_snd():
    n = int(0.06 * SR)
    t = t_(n)
    x = hp(rs.randn(n), 2500) * np.exp(-t * 180) * 0.7
    x += np.sin(2 * np.pi * 1600 * t) * np.exp(-t * 90) * 0.5
    return x


def pop_snd():
    n = int(0.2 * SR)
    t = t_(n)
    f = 380 + 700 * (1 - np.exp(-t * 28))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 16)
    return x * 0.8 + hp(rs.randn(n), 4000) * np.exp(-t * 60) * 0.1


def tick_snd(f):
    n = int(0.03 * SR)
    t = t_(n)
    return (np.sin(2 * np.pi * f * t) * 0.35 + hp(rs.randn(n), 3000) * 0.4) * np.exp(-t * 130)


def whoosh(dur=0.7, up=True):
    n = int(dur * SR)
    x = rs.randn(n)
    out = np.zeros(n)
    segs = 18
    for s in range(segs):
        a, b = s * n // segs, (s + 1) * n // segs
        k = s / segs if up else 1 - s / segs
        fc = 250 * (11000 / 250) ** k
        out[a:b] = bp(x, fc * 0.6, min(fc * 1.6, 20000))[a:b]
    e = np.sin(np.linspace(0, np.pi, n)) ** 2
    return out * e * 0.9


def impact():
    n = int(2.2 * SR)
    t = t_(n)
    sub = np.sin(2 * np.pi * np.cumsum(38 + 90 * np.exp(-t * 6)) / SR) * np.exp(-t * 2.2)
    air = lp(rs.randn(n), 900) * np.exp(-t * 5) * 0.5
    sh = hp(rs.randn(n), 5000) * np.exp(-t * 7) * 0.25
    return (sub * 1.1 + air + sh)


def chime():
    out = np.zeros(int(1.6 * SR))
    for j, m in enumerate((76, 80, 83, 88)):
        n = int(1.3 * SR)
        t = t_(n)
        f = midi(m)
        x = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 2.01 * f * t)) * np.exp(-t * 3.2)
        i = int(j * 0.075 * SR)
        out[i:i + n] += x * 0.5
    return out


def shimmer():
    n = int(1.0 * SR)
    t = t_(n)
    x = np.zeros(n)
    for j in range(7):
        f = midi(84 + j * 3)
        x += np.sin(2 * np.pi * f * t) * np.exp(-((t - 0.1 * j) ** 2) * 18) * 0.25
    return x


ev = json.load(open(os.path.join(HERE, 'events.json')))
last_type = -1
for e in ev:
    t, kind = e[0], e[1]
    if kind == 'click':
        add(sfx, click_snd(), t, 0.5, 0.0)
    elif kind == 'pop':
        add(sfx, pop_snd(), t, 0.32, 0.1)
    elif kind == 'tick':
        add(sfx, tick_snd(2600), t, 0.35, 0.2)
    elif kind == 'drop':
        add(sfx, pop_snd()[::-1][-int(0.2 * SR):], t, 0.22, -0.1)
        add(sfx, click_snd(), t + 0.18, 0.5)
    elif kind == 'ding':
        add(sfx, chime(), t, 0.36)
    elif kind == 'rise':
        add(sfx, shimmer(), t, 0.4)
    elif kind == 'whoosh':
        add(sfx, whoosh(0.7, True), t - 0.3, 0.32)
    elif kind == 'hit':
        add(sfx, impact(), t, 0.7)
    elif kind == 'buzz':
        n = int(0.32 * SR)
        add(sfx, np.sign(np.sin(2 * np.pi * 110 * t_(n))) * np.exp(-t_(n) * 7) * 0.25, t, 0.4)
    elif kind == 'type':
        d = e[2] or 0.5
        k = int(d * 24)
        for j in range(k):
            add(sfx, tick_snd(2200 + (j * 137) % 900), t + j * d / max(k, 1), 0.10, ((j % 3) - 1) * 0.3)

# scene dives and arrivals, from the beat clock
beats = [TM[k] for k in TM if k not in ('end', 's00', 's01')]
for t in beats:
    add(sfx, whoosh(0.8, True), t - 0.6, 0.45)
    add(sfx, whoosh(0.7, False), t, 0.24, 0.2)
add(sfx, impact(), ACT1 + 0.9, 0.7)
add(sfx, shimmer(), ACT1 + 1.15, 0.5)
add(sfx, whoosh(1.4, True), CLOSE - 1.2, 0.5)
add(sfx, impact(), LOGO, 1.0)
add(sfx, shimmer(), LOGO + 0.05, 0.6)
sfx = reverb(sfx, 0.9, 0.16, 11)

# ---------------------------------------------------------------- voice
CUES = json.load(open(os.path.join(HERE, 'vo', 'cues.json')))
voice = np.zeros((2, N))
vo_env = np.zeros(N)
for c in CUES:
    at = c['start']
    w = wave.open(os.path.join(HERE, 'vo', c['id'] + '.wav'))
    raw = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
    if w.getnchannels() == 2:
        raw = raw[::2]
    x = signal.resample_poly(raw, SR, w.getframerate())
    x = hp(x, 90)
    x = x + 0.25 * bp(x, 2500, 5500, 2)
    x /= np.max(np.abs(x)) + 1e-9
    x = np.tanh(x * 1.6) / np.tanh(1.6)
    add(voice, x, at, 0.82)
    i = int(at * SR)
    vo_env[i:i + len(x)] = np.maximum(vo_env[i:i + len(x)], np.abs(x[: N - i]))
voice = reverb(voice, 0.55, 0.07, 13)

# duck the music and sfx under the voice
sm = lp(vo_env, 14, 1)
sm = np.clip(sm / (np.max(sm) + 1e-9) * 3.0, 0, 1)
duck_m = 1 - 0.62 * sm
duck_s = 1 - 0.35 * sm
bed = music * duck_m
fx = sfx * duck_s

# ---------------------------------------------------------------- master
def rms(x):
    return np.sqrt(np.mean(x ** 2) + 1e-12)


bed *= 0.095 / rms(bed[:, int(ACT1 * SR):int(CLOSE * SR)])
fx *= 1.0
v_target = 0.155
voice *= v_target / (rms(voice[:, voice[0] != 0]) + 1e-9)
mix = bed + fx * 0.55 + voice
# fades
f_in = int(0.3 * SR)
mix[:, :f_in] *= np.linspace(0, 1, f_in)
f_out = int(1.2 * SR)
end = int(DUR * SR)
mix[:, end - f_out:end] *= np.linspace(1, 0, f_out)
mix[:, end:] = 0
# soft limiter
mix = np.tanh(mix * 1.15) / np.tanh(1.15)
peak = np.max(np.abs(mix))
mix *= 0.70 / peak
out = (mix[:, :int(DUR * SR)].T * 32767).astype(np.int16)
with wave.open(os.path.join(HERE, 'mix.wav'), 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(out.tobytes())
vo_only = (voice[:, :int(DUR * SR)].T / (np.max(np.abs(voice)) + 1e-9) * 0.9 * 32767).astype(np.int16)
with wave.open(os.path.join(HERE, 'voiceover.wav'), 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(vo_only.tobytes())
print('ok', out.shape, 'peak dBFS', round(20 * np.log10(np.max(np.abs(out)) / 32767), 2))
