import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'motion/react'

/**
 * CURSOR RING FIELD — a Poisson-scattered field of soft capsules that a pulsing
 * ring, dragged along under the pointer, lights up and shoves outward.
 *
 * Ported into Collabify from a Framer component. The engine is unchanged: the
 * GPGPU simulation, the shaders, the Poisson sampler and every tuning constant
 * are the original's. Three things are different, and only three:
 *
 *   1. The palette defaults to the brand ramp rather than the original's blues.
 *   2. The Framer property-control shapes are gone. They existed to keep old
 *      Framer instances bound as the control panel changed shape over time,
 *      and there are no such instances here — this is called from one place
 *      with plain props.
 *   3. `prefers-reduced-motion` renders nothing at all. The original had no
 *      such check because a Framer canvas has no such reader. Here it does:
 *      this is a continuously moving background behind a page's first screen,
 *      which is exactly what that preference is about.
 *
 * ---------------------------------------------------------------------------
 *
 * WHY GPGPU AND NOT A PURE VERTEX-SHADER SCENE. Each frame a point keeps 80% of
 * last frame's displacement, its scale eases toward the ring band, and its
 * "energy" is a decaying accumulator of that scale. That history lives in a
 * floating-point texture — one texel per point, `xy` position, `z` scale, `w`
 * energy — integrated by a fragment shader into a second texture which is then
 * swapped in. The CPU never touches a particle.
 *
 * WHAT THE RING IS. Not geometry. Three smoothsteps of the distance from each
 * point's HOME position to the ring centre: a wide band, a thin hot band, and
 * the fill inside. Sampling from HOME and not from the live position is what
 * keeps the ring a ring — read the live position and a shoved point carries its
 * own halo with it, smearing the band into a comet.
 *
 * THE SIMULATION IS PER-FRAME, ON PURPOSE. Its decay constants are NOT
 * normalised to wall-clock time; the position line is a feedback loop whose
 * fixed point depends on the decay, so normalising it makes every late frame
 * rescale the whole field about the origin. Full working above SIM_FRAG. Only
 * the ring's cursor follow is dt-corrected, because that one IS a relaxation.
 *
 * CONTEXT LADDER: WebGL2 + EXT_color_buffer_float (RGBA32F), else WebGL2
 * RGBA16F, else WebGL1 + OES_texture_float + WEBGL_color_buffer_float, else a
 * static fallback that runs the same field maths inline in the render vertex
 * shader with the memory terms dropped. Shaders are GLSL ES 1.00 so one set
 * compiles on both.
 */

/* ---------------------------------------------------------------- constants */

const FIELD = 500 // the sampling domain, in source units, before centring
const HALF = FIELD / 2
const WORLD = 5 // unit field [-1,1] maps to [-5,5] world units
const CURSOR_REACH = 0.175 // the source's cursor→ring gain. NOT 1/WORLD.
const CURSOR_LERP = 0.12 // ~130ms time constant while the pointer is over
const WANDER_LERP = 0.01 // the resting drift when it is not
const HANDOVER_LERP = 0.08 // crossfade between the two, target AND rate
const CURSOR_JITTER = 0.01 // live edge on the ring, not a second input
const FOV = 40
const DPR_CAP = 2
const MAX_POINTS = 65536
const TAU = Math.PI * 2
const MAX_COLORS = 5 // must match uColors[] in the shader
const RING_EDGE = 4 // the thin inner band — the one that pushes

/**
 * The brand ramp, dark end first.
 *
 * The ramp runs from `uColors[0]` upward as the per-point colour noise rises,
 * and every point is then multiplied by its own ring energy — so the low stops
 * are what the resting field looks like and the top stop is what the ring
 * lights up as it passes. Navy at rest, amber where the ring is, which is the
 * same relationship the rest of the page uses the accent for.
 */
const DEFAULT_COLORS = ['#1e2864', '#3d4da3', '#f0b429']

/* ------------------------------------------------------------ glsl fragments */

// Ashima 3D simplex. Both programs need it: the sim shader for the displacement
// field, the render shader for the per-point colour and sprite rotation.
const NOISE = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(
      i.z+vec4(0.0,i1.z,i2.z,1.0))
    + i.y+vec4(0.0,i1.y,i2.y,1.0))
    + i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`

// THE FIELD, in one place. The simulation shader calls this and then integrates
// the memory terms on top; the static fallback calls the same function from the
// render vertex shader and uses the result raw. One definition means the
// fallback cannot silently drift away from the real thing.
const FIELD_TERMS = `
void fieldTerms(
    vec2 ref, vec2 ringPos, float time,
    float ringRadius, float w1, float w2, float turb,
    out vec2 disp, out float bandT, out float bandHot
){
    float dist = distance(ref, ringPos);

    // Break the ring's own edge with a slow noise so it never reads as a
    // mathematically clean circle. Only the OUTER smoothstep uses the wobbled
    // distance — wobbling both would just translate the band.
    float n0 = snoise(vec3(ref * 0.2 + vec2(18.4924, 72.9744), time * 0.5));
    float dist1 = distance(ref + (n0 * 0.005), ringPos);

    float t  = smoothstep(ringRadius - (w1 * 2.0), ringRadius, dist)
             - smoothstep(ringRadius, ringRadius + w1, dist1);
    float t2 = smoothstep(ringRadius - (w2 * 2.0), ringRadius, dist)
             - smoothstep(ringRadius, ringRadius + w2, dist1);
    float t3 = smoothstep(ringRadius + w2, ringRadius, dist);

    t  = pow(max(t, 0.0), 2.0);
    t2 = pow(max(t2, 0.0), 3.0);

    t += t2 * 3.0;
    t += t3 * 0.4;
    t += snoise(vec3(ref * 30.0 + vec2(11.4924, 12.9744), time * 0.5)) * t3 * 0.5;

    // Baseline shimmer, present with no ring anywhere near.
    float nS = snoise(vec3(ref * 2.0 + vec2(18.4924, 72.9744), time * 0.5));
    t += pow((nS + 1.5) * 0.5, 2.0) * 0.6;

    float n1 = snoise(vec3(ref * 4.0 + vec2(88.494, 32.4397), time * 0.35));
    float n2 = snoise(vec3(ref * 4.0 + vec2(50.904, 120.947), time * 0.35));
    float n3 = snoise(vec3(ref * 20.0 + vec2(18.4924, 72.9744), time * 0.5));
    float n4 = snoise(vec3(ref * 20.0 + vec2(50.904, 120.947), time * 0.5));

    vec2 d = vec2(n1, n2) * 0.03 + vec2(n3, n4) * 0.005;
    d.x += sin((ref.x * 20.0) + (time * 4.0)) * 0.02 * clamp(dist, 0.0, 1.0);
    d.y += cos((ref.y * 20.0) + (time * 3.0)) * 0.02 * clamp(dist, 0.0, 1.0);

    disp = d * turb;
    bandT = t;
    bandHot = t2;
}
`

/* ------------------------------------------------------------- sim  program */

const SIM_VERT = `
precision highp float;
attribute vec2 aPos;
varying vec2 vUV;
void main(){
    vUV = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}
`

// State layout: rg = live position (unit space), b = scale, a = energy.
//
// THE DECAY CONSTANTS ARE PER-FRAME, NOT PER-SECOND, AND THAT IS DELIBERATE.
// The position line is not a relaxation toward a target — it is a feedback loop
// whose FIXED POINT depends on the decay:
//
//     F = ref + disp + 0.25 * F * k      =>      F* = (ref + disp) / (1 - 0.25k)
//
// With the source's k = 0.8 that gain is a fixed 1.25x. Make k depend on frame
// time and the gain moves with it, so every ordinary late frame rescales the
// entire field about the origin at once — a correlated radial pulse that reads
// as the whole field jumping toward the viewer.
const SIM_FRAG = `
precision highp float;

uniform sampler2D uState;
uniform sampler2D uRefs;
uniform vec2  uRingPos;
uniform float uRingRadius;
uniform float uRingWidth;
uniform float uRingWidth2;
uniform float uPush;
uniform float uTurb;
uniform float uTime;

varying vec2 vUV;

${NOISE}
${FIELD_TERMS}

void main(){
    vec4 frame = texture2D(uState, vUV);
    vec2 ref   = texture2D(uRefs, vUV).xy;

    float scale  = frame.z;
    float energy = frame.w;
    float time   = uTime * 0.5;

    vec2 disp; float t; float t2;
    fieldTerms(ref, uRingPos, time, uRingRadius, uRingWidth, uRingWidth2, uTurb, disp, t, t2);

    // The memory term — the whole reason this needs a state texture.
    vec2 mem = frame.xy * 0.8;

    // Radial shove away from the ring centre, gated on the thin hot band.
    mem -= (uRingPos - (ref + disp)) * pow(max(t2, 0.0), 0.75) * uPush;

    scale += (t - scale) * 0.2;

    vec2 finalPos = ref + disp + (mem * 0.25);

    energy = energy * 0.5 + scale * 0.25;

    gl_FragColor = vec4(finalPos, scale, energy);
}
`

/* ---------------------------------------------------------- render program */

// The camera is FIXED on +Z looking at the origin, so the whole projection is
// two multiplies and a constant w. Every point sits on the z = 0 plane, which
// is why gl_PointSize carries no attenuation term — there is nothing to
// attenuate.
const RENDER_VERT = (isStatic: boolean) => `
precision highp float;

attribute vec2 aUV;
attribute vec2 aRef;

uniform sampler2D uState;
uniform float uProjF;
uniform float uAspect;
uniform float uCamDist;
uniform float uPointScale;
${
  isStatic
    ? `uniform vec2  uRingPos;
uniform float uRingRadius;
uniform float uRingWidth;
uniform float uRingWidth2;
uniform float uTurb;
uniform float uTime;`
    : ``
}

varying vec2  vLocalPos;
varying float vScale;
varying float vEnergy;

${isStatic ? NOISE : ``}
${isStatic ? FIELD_TERMS : ``}

void main(){
${
  isStatic
    ? `    vec2 disp; float t; float t2;
    fieldTerms(aRef, uRingPos, uTime * 0.5, uRingRadius, uRingWidth, uRingWidth2, uTurb, disp, t, t2);
    vec4 state = vec4(aRef + disp, t, t * 0.5);`
    : `    vec4 state = texture2D(uState, aUV);`
}

    vLocalPos = state.xy;
    vScale    = state.z;
    vEnergy   = state.w;

    vec2 world = state.xy * ${WORLD.toFixed(1)};

    gl_Position = vec4(world.x * uProjF / uAspect, world.y * uProjF, 0.0, uCamDist);

    gl_PointSize = max(vScale, 0.0) * 7.0 * uPointScale;
}
`

// The sprite is a rounded capsule, not a disc, rotated to point at the ring
// centre — that radial alignment is what reads as a shockwave rather than as
// noise. The noise on the angle stops the alignment being perfect, which would
// band into visible spokes.
const RENDER_FRAG = `
precision highp float;

varying vec2  vLocalPos;
varying float vScale;
varying float vEnergy;

uniform vec3  uColors[${MAX_COLORS}];
uniform int   uColorCount;
uniform vec2  uRingPos;
uniform float uTime;

${NOISE}

float sdRoundBox(in vec2 p, in vec2 b, in float r){
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

vec2 rotate(vec2 v, float a){
    float s = sin(a);
    float c = cos(a);
    return mat2(c, s, -s, c) * v;
}

void main(){
    float noiseAngle = snoise(vec3(vLocalPos * 10.0 + vec2(18.4924, 72.9744), uTime * 0.85));
    float noiseColor = snoise(vec3(vLocalPos * 2.0  + vec2(74.664,  91.556),  uTime * 0.5));
    noiseColor = (noiseColor + 1.0) * 0.5;

    float angle = atan(vLocalPos.y - uRingPos.y, vLocalPos.x - uRingPos.x);

    vec2 uv = gl_PointCoord.xy - vec2(0.5);
    uv.y *= -1.0;
    uv = rotate(uv, -angle + (noiseAngle * 0.5));

    // An evenly-spaced N-stop ramp. The loop is what makes this legal on
    // WebGL1: GLSL ES 1.00 only allows a uniform array to be indexed by a
    // constant-index-expression, and a loop index is one.
    float p = smoothstep(0.0, 0.75, pow(noiseColor, 2.0));
    vec3 color = uColors[0];
    for (int i = 0; i < ${MAX_COLORS - 1}; i++) {
        if (i < uColorCount - 1) {
            float span = 1.0 / float(uColorCount - 1);
            float t = clamp((p - float(i) * span) / span, 0.0, 1.0);
            color = mix(color, uColors[i + 1], t);
        }
    }

    float d = sdRoundBox(uv, vec2(0.5, 0.2), 0.25);
    float mask = smoothstep(0.1, 0.0, d);

    float a = mask * smoothstep(0.1, 0.2, vScale);
    if (a < 0.01) discard;

    color = clamp(color, 0.0, 1.0);
    color *= clamp(vEnergy, 0.0, 1.0);

    gl_FragColor = vec4(color, clamp(a, 0.0, 1.0));
}
`

/* -------------------------------------------------------------- gl helpers */

/**
 * Both context versions are driven through one surface.
 *
 * The original left every GL handle as `any`. WebGL1 is a subset of the calls
 * used here — the only WebGL2-only names are the sized internal formats, which
 * are read from the context object and guarded by the extension probe below —
 * so a WebGL1 context is widened to this once, at the point it is created,
 * rather than typed away sixteen times.
 */
type GL = WebGL2RenderingContext
type Fmt = { internal: number; format: number; type: number }
type Target = { tex: WebGLTexture; fbo: WebGLFramebuffer; ok: boolean }
type Prog = {
  prog: WebGLProgram
  u: Record<string, WebGLUniformLocation | null>
  nulls: string[]
}

function compile(gl: GL, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)
  // Null here means the context is gone. Same outcome as a compile failure, so
  // it takes the same exit.
  if (!sh) throw new Error('could not create shader')
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(log || 'shader compile failed')
  }
  return sh
}

// Returns the uniform map AND the names that came back null. A typo'd
// getUniformLocation fails silently and the effect just never appears.
function program(gl: GL, vs: string, fs: string, names: string[]): Prog {
  const prog = gl.createProgram()
  if (!prog) throw new Error('could not create program')
  const v = compile(gl, gl.VERTEX_SHADER, vs)
  const f = compile(gl, gl.FRAGMENT_SHADER, fs)
  gl.attachShader(prog, v)
  gl.attachShader(prog, f)
  gl.linkProgram(prog)
  gl.deleteShader(v)
  gl.deleteShader(f)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog)
    gl.deleteProgram(prog)
    throw new Error(log || 'program link failed')
  }
  const u: Record<string, WebGLUniformLocation | null> = {}
  const nulls: string[] = []
  for (const n of names) {
    const loc = gl.getUniformLocation(prog, n)
    if (loc === null) nulls.push(n)
    u[n] = loc
  }
  return { prog, u, nulls }
}

// RGBA32F first; RGBA16F second because WebGL2 makes it colour-renderable in
// core and half-float is enough here; WebGL1 float third because it needs two
// separate extensions; static last.
function makeContext(canvas: HTMLCanvasElement) {
  const opts = {
    alpha: true,
    antialias: false,
    // NOT premultiplied: the fragment shader emits straight colour and the
    // blend func below is the classic source-over pair.
    premultipliedAlpha: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance' as const,
    preserveDrawingBuffer: true,
  }
  let gl = canvas.getContext('webgl2', opts) as GL | null
  let fmt: Fmt | null
  if (gl) {
    fmt = gl.getExtension('EXT_color_buffer_float')
      ? { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT }
      : { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }
  } else {
    gl = (canvas.getContext('webgl', opts) ||
      canvas.getContext('experimental-webgl', opts)) as GL | null
    if (!gl) return null
    const ok =
      gl.getExtension('OES_texture_float') && gl.getExtension('WEBGL_color_buffer_float')
    fmt = ok ? { internal: gl.RGBA, format: gl.RGBA, type: gl.FLOAT } : null
  }
  // The render vertex shader samples the state texture. A device reporting zero
  // vertex texture units cannot run the sim whatever the extensions claim.
  if (gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 2) fmt = null
  return { gl, fmt }
}

function stateTexture(gl: GL, fmt: Fmt, size: number, pixels: ArrayBufferView | null) {
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, size, size, 0, fmt.format, fmt.type, pixels || null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.bindTexture(gl.TEXTURE_2D, null)
  return tex
}

function renderTarget(gl: GL, fmt: Fmt, size: number): Target {
  const tex = stateTexture(gl, fmt, size, null)
  const fbo = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return { tex, fbo, ok }
}

/* --------------------------------------------------------- point generation */

// Seeded, so two runs scatter identically and a screenshot diff means something.
function mulberry32(a: number) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const linMap = (x: number, a: number, b: number, c: number, d: number) =>
  ((x - a) * (d - c)) / (b - a) + c

// Bridson Poisson-disk, annulus [minD, maxD]. Even spacing with no lattice is
// the whole point: a square grid shows moiré the instant the ring's smoothsteps
// sweep across it.
function poissonDisk(
  size: number,
  minD: number,
  maxD: number,
  tries: number,
  rand: () => number,
) {
  const cell = minD / Math.SQRT2
  const gw = Math.ceil(size / cell)
  const gh = Math.ceil(size / cell)
  const grid = new Int32Array(gw * gh).fill(-1)
  const px: number[] = []
  const py: number[] = []
  const active: number[] = []
  const minD2 = minD * minD

  const add = (x: number, y: number) => {
    const i = px.length
    px.push(x)
    py.push(y)
    grid[((y / cell) | 0) * gw + ((x / cell) | 0)] = i
    active.push(i)
  }

  add(rand() * size, rand() * size)

  while (active.length > 0 && px.length < MAX_POINTS) {
    const ai = (rand() * active.length) | 0
    const idx = active[ai]
    let placed = false
    for (let t = 0; t < tries; t++) {
      const ang = rand() * TAU
      const r = minD + (maxD - minD) * rand()
      const nx = px[idx] + Math.cos(ang) * r
      const ny = py[idx] + Math.sin(ang) * r
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
      const cx = (nx / cell) | 0
      const cy = (ny / cell) | 0
      let ok = true
      for (let j = Math.max(0, cy - 2); j <= Math.min(gh - 1, cy + 2) && ok; j++) {
        for (let i = Math.max(0, cx - 2); i <= Math.min(gw - 1, cx + 2); i++) {
          const q = grid[j * gw + i]
          if (q < 0) continue
          const dx = px[q] - nx
          const dy = py[q] - ny
          if (dx * dx + dy * dy < minD2) {
            ok = false
            break
          }
        }
      }
      if (ok) {
        add(nx, ny)
        placed = true
        break
      }
    }
    if (!placed) {
      active[ai] = active[active.length - 1]
      active.pop()
    }
  }
  return { px, py, count: px.length }
}

// Density interpolates the sampler's min and max spacing, so a higher number is
// a tighter field. Buffers are rebuilt on change; the context is not.
function buildField(density: number) {
  const rand = mulberry32(0x9e3779b9)
  const minD = linMap(density, 0, 300, 10, 2)
  const maxD = linMap(density, 0, 300, 11, 3)
  const { px, py, count } = poissonDisk(FIELD, minD, maxD, 20, rand)

  let texSize = 8
  while (texSize * texSize < count) texSize *= 2

  const refs = new Float32Array(texSize * texSize * 4)
  const aUV = new Float32Array(count * 2)
  const aRef = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    const x = (px[i] - HALF) / HALF
    const y = (py[i] - HALF) / HALF
    refs[i * 4 + 0] = x
    refs[i * 4 + 1] = y
    aRef[i * 2 + 0] = x
    aRef[i * 2 + 1] = y
    // Texel CENTRE, not corner: NEAREST sampling on the edge of a texel is a
    // coin flip and half the points would read a neighbour's state.
    aUV[i * 2 + 0] = ((i % texSize) + 0.5) / texSize
    aUV[i * 2 + 1] = (Math.floor(i / texSize) + 0.5) / texSize
  }
  return { count, texSize, refs, aUV, aRef }
}

/* ---------------------------------------------------------- ambient wander */

// 1D value noise with a smoothstep between integer stops. Two of these, at
// different rates and offsets, walk the ring around the frame with no pointer.
function valueNoise1(x: number, seed: number) {
  const i = Math.floor(x)
  const f = x - i
  const h = (n: number) => {
    const s = Math.sin((n + seed) * 127.1) * 43758.5453
    return s - Math.floor(s)
  }
  const u = f * f * (3 - 2 * f)
  return h(i) * (1 - u) + h(i + 1) * u
}

/* ------------------------------------------------------------------- colour */

function hexToRgb(hex: string): [number, number, number] {
  if (typeof hex !== 'string') return [1, 1, 1]
  let s = hex.trim()
  const m = s.match(/^rgba?\(([^)]+)\)$/i)
  if (m) {
    const p = m[1].split(',').map((v) => parseFloat(v))
    return [(p[0] || 0) / 255, (p[1] || 0) / 255, (p[2] || 0) / 255]
  }
  s = s.replace('#', '')
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2]
  if (s.length === 8) s = s.slice(0, 6)
  if (s.length !== 6) return [1, 1, 1]
  const n = parseInt(s, 16)
  if (!isFinite(n)) return [1, 1, 1]
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/* ---------------------------------------------------------------- component */

/** Everything the loop reads each frame, already converted out of dial units. */
type Live = {
  colors: Float32Array
  colorCount: number
  dotSize: number
  speed: number
  camDist: number
  ringRadius: number
  ringWidth: number
  ringEdge: number
  push: number
  turb: number
}

type Props = {
  /** Painted behind the canvas. `transparent` lets the hero's own ground show. */
  background?: string
  /** Ramp, dark end first. Up to five stops. */
  colors?: string[]
  /** Higher is a tighter field. The original's dial, 0–300. */
  density?: number
  dotSize?: number
  speed?: number
  cameraDistance?: number
  ring?: { radius?: number; width?: number; push?: number; turbulence?: number }
  className?: string
  style?: React.CSSProperties
}

export function CursorRingField({
  background = 'transparent',
  colors = DEFAULT_COLORS,
  density = 300,
  dotSize = 120,
  speed = 6,
  cameraDistance = 160,
  ring = {},
  className = '',
  style,
}: Props) {
  const reduce = useReducedMotion()

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)

  // Push and turbulence default to 0: the tuned look is a still field the ring
  // lights rather than shoves. Both still work — off by default, not absent.
  const ringRadius = ring.radius ?? 12
  const ringWidth = ring.width ?? 9
  const ringPush = ring.push ?? 0
  const turbulence = ring.turbulence ?? 0

  // Every live input goes through this ref. Putting any of them in the effect
  // deps would rebuild the GL context on a colour tweak.
  const live = useRef<Live | null>(null)
  useEffect(() => {
    const swatches = colors.filter(Boolean).slice(0, MAX_COLORS).map(hexToRgb)
    if (swatches.length === 0) swatches.push(hexToRgb(DEFAULT_COLORS[0]))
    // Slots past the live count are padded with the last colour rather than
    // left undefined — an unwritten uniform reads as garbage on some drivers.
    const flat = new Float32Array(MAX_COLORS * 3)
    for (let i = 0; i < MAX_COLORS; i++) {
      const c = swatches[Math.min(i, swatches.length - 1)]
      flat[i * 3 + 0] = c[0]
      flat[i * 3 + 1] = c[1]
      flat[i * 3 + 2] = c[2]
    }
    live.current = {
      colors: flat,
      colorCount: swatches.length,
      dotSize: dotSize / 100,
      speed: speed / 50,
      camDist: cameraDistance / 100,
      ringRadius: ringRadius / 100,
      ringWidth: Math.max(ringWidth, 1) / 100,
      ringEdge: RING_EDGE / 100,
      push: ringPush / 100,
      turb: turbulence / 100,
    }
  })

  // Density is the one input that cannot be a plain ref read: it changes how
  // many points exist. Its own ref and a dirty flag; the loop rebuilds buffers
  // and textures in place.
  const densityRef = useRef(density)
  const densityDirty = useRef(true)
  useEffect(() => {
    if (densityRef.current !== density) {
      densityRef.current = density
      densityDirty.current = true
    }
  }, [density])

  useEffect(() => {
    // Reduced motion gets no canvas at all. This is a continuously moving
    // background behind a page's first screen — slowing it down would not be
    // honouring the preference, and there is nothing here to read statically.
    if (reduce) return

    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return

    const ctx = makeContext(canvas)
    if (!ctx) return
    const { gl, fmt } = ctx
    const useSim = !!fmt

    // Both programs come back from one call rather than from two mutable
    // bindings: a `let` captured by the loop's closure widens back to nullable
    // on every read, which would mean asserting at each of the twenty call
    // sites below, and its initial null was never read anyway.
    //
    // A compile failure must not take the page down with it. It returns null,
    // the hero keeps its gradient, and nobody sees an error.
    const build = (): { sim: Prog | null; render: Prog } | null => {
      try {
        const simProg = useSim
          ? program(gl, SIM_VERT, SIM_FRAG, [
              'uState',
              'uRefs',
              'uRingPos',
              'uRingRadius',
              'uRingWidth',
              'uRingWidth2',
              'uPush',
              'uTurb',
              'uTime',
            ])
          : null
        const renderNames = [
          'uProjF',
          'uAspect',
          'uCamDist',
          'uPointScale',
          // An array uniform's location is looked up by its first element, and
          // uniform3fv on that location writes the whole run.
          'uColors[0]',
          'uColorCount',
          'uRingPos',
          'uTime',
        ]
        if (useSim) renderNames.push('uState')
        else renderNames.push('uRingRadius', 'uRingWidth', 'uRingWidth2', 'uTurb')
        return {
          sim: simProg,
          render: program(gl, RENDER_VERT(!useSim), RENDER_FRAG, renderNames),
        }
      } catch (e) {
        console.warn('CursorRingField:', (e as Error).message)
        return null
      }
    }

    const built = build()
    if (!built) return
    const { sim, render } = built

    /* ---- static geometry: the fullscreen quad the sim renders through ---- */
    const quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

    /* ---- per-density buffers, rebuilt in place ---- */
    const uvBuf = gl.createBuffer()
    const refBuf = gl.createBuffer()
    let refsTex: WebGLTexture | null = null
    let rt1: Target | null = null
    let rt2: Target | null = null
    let count = 0
    let texSize = 8

    function disposeField() {
      if (refsTex) gl.deleteTexture(refsTex)
      if (rt1) {
        gl.deleteTexture(rt1.tex)
        gl.deleteFramebuffer(rt1.fbo)
      }
      if (rt2) {
        gl.deleteTexture(rt2.tex)
        gl.deleteFramebuffer(rt2.fbo)
      }
      refsTex = null
      rt1 = null
      rt2 = null
    }

    function rebuildField(d: number) {
      disposeField()
      const f = buildField(d)
      count = f.count
      texSize = f.texSize

      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf)
      gl.bufferData(gl.ARRAY_BUFFER, f.aUV, gl.STATIC_DRAW)
      gl.bindBuffer(gl.ARRAY_BUFFER, refBuf)
      gl.bufferData(gl.ARRAY_BUFFER, f.aRef, gl.STATIC_DRAW)

      if (!useSim) return

      // A Float32Array cannot be uploaded as HALF_FLOAT, so the seed data goes
      // up with an RGBA/FLOAT source format; WebGL2 accepts that for an RGBA16F
      // internal format and converts on the way in.
      const src = { internal: fmt.internal, format: gl.RGBA, type: gl.FLOAT }
      refsTex = stateTexture(gl, src, texSize, f.refs)
      rt1 = renderTarget(gl, fmt, texSize)
      rt2 = renderTarget(gl, fmt, texSize)

      // Seed BOTH targets. Seeding only one means the first swapped frame reads
      // an uninitialised texture and the whole field flashes from the origin.
      gl.bindTexture(gl.TEXTURE_2D, rt1.tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, texSize, texSize, 0, gl.RGBA, gl.FLOAT, f.refs)
      gl.bindTexture(gl.TEXTURE_2D, rt2.tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, texSize, texSize, 0, gl.RGBA, gl.FLOAT, f.refs)
      gl.bindTexture(gl.TEXTURE_2D, null)
    }

    /* ---- sizing ---- */
    let dpr = 1
    let cssW = 1
    let cssH = 1
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)
      cssW = Math.max(canvas.clientWidth || host.clientWidth || 1, 1)
      cssH = Math.max(canvas.clientHeight || host.clientHeight || 1, 1)
      const w = Math.max(1, Math.round(cssW * dpr))
      const h = Math.max(1, Math.round(cssH * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    /* ---- pointer. The ONLY interaction: the ring follows the cursor. ---- */
    const pointer = { x: 0, y: 0, over: false }
    const ringPos = { x: 0, y: 0 }
    // 0 = free wander, 1 = locked to the pointer. Eased, never toggled, so the
    // target and the follow rate both cross over instead of stepping.
    let follow = 0

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      pointer.x = ((e.clientX - r.left) / Math.max(r.width, 1)) * 2 - 1
      pointer.y = -(((e.clientY - r.top) / Math.max(r.height, 1)) * 2 - 1)
      pointer.over = pointer.x >= -1 && pointer.x <= 1 && pointer.y >= -1 && pointer.y <= 1
    }
    const onLeave = () => {
      pointer.over = false
    }
    // Bound on WINDOW, not the host: the ring keeps easing back to its wander
    // the moment the pointer leaves, instead of freezing at the edge.
    window.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)

    /* ---- loop ---- */
    let raf = 0
    let last = 0
    let simTime = 0
    let wander = 0
    let ping = true

    const posLocSim = sim ? gl.getAttribLocation(sim.prog, 'aPos') : -1
    // Each path leaves one attribute unused — aRef in the GPGPU path, aUV in
    // the static one — and an unused attribute links to -1, which
    // enableVertexAttribArray rejects with INVALID_VALUE.
    const uvLoc = gl.getAttribLocation(render.prog, 'aUV')
    const refLoc = gl.getAttribLocation(render.prog, 'aRef')

    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    // Separate alpha so the canvas composites over the hero's ground instead of
    // accumulating destination alpha twice.
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const L = live.current
      // The effect that fills this runs after the first paint, so the first
      // frame or two can arrive before it. Nothing to draw yet.
      if (!L) return

      if (densityDirty.current) {
        densityDirty.current = false
        rebuildField(densityRef.current)
      }
      if (!count) return

      const dtRaw = last ? (now - last) / 1000 : 1 / 60
      last = now
      const dt = Math.min(dtRaw, 1 / 20)
      simTime = (simTime + dt * L.speed) % 3600
      wander += dt * L.speed

      const aspect = Math.max(cssW / Math.max(cssH, 1), 0.0001)
      const projF = 1 / Math.tan(((FOV * Math.PI) / 180) / 2)

      /* -- ring target. The camera is fixed on +Z looking at the origin, so the
            ray-cast onto the z = 0 plane collapses to a scale. -- */
      const wx = (valueNoise1(wander * 0.66, 94.234) - 0.5) * 2
      const wy = (valueNoise1(wander * 0.75, 21.028) - 0.5) * 2

      // Handover first: leaving the frame walks the ring off the pointer and
      // back onto its wander rather than cutting to it.
      follow +=
        ((pointer.over ? 1 : 0) - follow) * (1 - Math.pow(1 - HANDOVER_LERP, dt * 60))

      const wanderX = wx * 0.2
      const wanderY = wy * 0.1
      let tx = wanderX
      let ty = wanderY
      if (follow > 0.0001) {
        const worldX = (pointer.x * aspect * L.camDist) / projF
        const worldY = (pointer.y * L.camDist) / projF
        const cx = worldX * CURSOR_REACH + wx * CURSOR_JITTER
        const cy = worldY * CURSOR_REACH + wy * CURSOR_JITTER
        tx = wanderX + (cx - wanderX) * follow
        ty = wanderY + (cy - wanderY) * follow
      }
      // Safe to dt-correct, unlike the simulation's constants: this is a
      // relaxation toward the pointer, so the equilibrium is the pointer
      // whatever the rate. Only the time constant moves.
      const lerp = WANDER_LERP + (CURSOR_LERP - WANDER_LERP) * follow
      const rk = 1 - Math.pow(1 - lerp, dt * 60)
      ringPos.x += (tx - ringPos.x) * rk
      ringPos.y += (ty - ringPos.y) * rk

      const radius = L.ringRadius + Math.sin(simTime) * 0.03 + Math.cos(simTime * 3) * 0.02

      /* -- simulation pass -- */
      if (useSim && sim && rt1 && rt2) {
        const src = ping ? rt1 : rt2
        const dst = ping ? rt2 : rt1
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo)
        gl.viewport(0, 0, texSize, texSize)
        gl.disable(gl.BLEND)
        gl.useProgram(sim.prog)
        gl.bindBuffer(gl.ARRAY_BUFFER, quad)
        gl.enableVertexAttribArray(posLocSim)
        gl.vertexAttribPointer(posLocSim, 2, gl.FLOAT, false, 0, 0)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, src.tex)
        gl.uniform1i(sim.u.uState, 0)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, refsTex)
        gl.uniform1i(sim.u.uRefs, 1)
        gl.uniform2f(sim.u.uRingPos, ringPos.x, ringPos.y)
        gl.uniform1f(sim.u.uRingRadius, radius)
        gl.uniform1f(sim.u.uRingWidth, L.ringWidth)
        gl.uniform1f(sim.u.uRingWidth2, L.ringEdge)
        gl.uniform1f(sim.u.uPush, L.push)
        gl.uniform1f(sim.u.uTurb, L.turb)
        gl.uniform1f(sim.u.uTime, simTime)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.enable(gl.BLEND)
        ping = !ping
      }

      /* -- render pass -- */
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(render.prog)

      if (uvLoc >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf)
        gl.enableVertexAttribArray(uvLoc)
        gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0)
      }
      if (refLoc >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, refBuf)
        gl.enableVertexAttribArray(refLoc)
        gl.vertexAttribPointer(refLoc, 2, gl.FLOAT, false, 0, 0)
      }

      if (useSim && rt1 && rt2) {
        const shown = ping ? rt1 : rt2
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, shown.tex)
        gl.uniform1i(render.u.uState, 0)
      } else {
        gl.uniform1f(render.u.uRingRadius, radius)
        gl.uniform1f(render.u.uRingWidth, L.ringWidth)
        gl.uniform1f(render.u.uRingWidth2, L.ringEdge)
        gl.uniform1f(render.u.uTurb, L.turb)
      }

      gl.uniform1f(render.u.uProjF, projF)
      gl.uniform1f(render.u.uAspect, aspect)
      gl.uniform1f(render.u.uCamDist, L.camDist)
      // Buffer width over dpr over 2000: keeps the dots the same visual size as
      // the component widens.
      gl.uniform1f(render.u.uPointScale, (cssW / 2000) * L.dotSize * dpr * 0.5)
      gl.uniform3fv(render.u['uColors[0]'], L.colors)
      gl.uniform1i(render.u.uColorCount, L.colorCount)
      gl.uniform2f(render.u.uRingPos, ringPos.x, ringPos.y)
      gl.uniform1f(render.u.uTime, simTime)

      gl.drawArrays(gl.POINTS, 0, count)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      disposeField()
      gl.deleteBuffer(quad)
      gl.deleteBuffer(uvBuf)
      gl.deleteBuffer(refBuf)
      if (sim) gl.deleteProgram(sim.prog)
      gl.deleteProgram(render.prog)
      // Deliberately NO WEBGL_lose_context.loseContext() — getContext() returns
      // the SAME context for this canvas, and StrictMode's mount → cleanup →
      // mount would remount onto a force-lost one and render black.
    }
    // Only the context needs rebuilding here. Colours, ring terms and speed are
    // all read live from the ref; density goes through its own dirty flag.
  }, [reduce])

  return (
    <div
      ref={hostRef}
      aria-hidden
      className={className}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', background, ...style }}
    >
      {!reduce && (
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            display: 'block',
          }}
        />
      )}
    </div>
  )
}
