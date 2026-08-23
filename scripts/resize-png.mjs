#!/usr/bin/env node
// Downscale a PNG without adding a dependency.
//
//   node scripts/resize-png.mjs src/assets/dyci-logo.png 256
//
// Why this exists: the school logo shipped at 2048×2048 and 1.7 MB for a slot
// 56 pixels wide — more bytes than the entire application bundle. Fixing that
// needed either an image library in the dependency tree for one file, or this.
//
// It handles exactly the case in front of it and says so loudly when the input
// is anything else: 8-bit RGBA, non-interlaced, which is what every asset here
// happens to be. A quiet wrong answer from a hand-rolled codec would be worse
// than the oversized file.

import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync, deflateSync } from 'node:zlib'

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function readChunks(buf) {
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) throw new Error('not a PNG')
  const chunks = []
  let at = 8
  while (at < buf.length) {
    const length = buf.readUInt32BE(at)
    const type = buf.toString('ascii', at + 4, at + 8)
    const data = buf.subarray(at + 8, at + 8 + length)
    chunks.push({ type, data })
    at += 12 + length
  }
  return chunks
}

/** Undo the per-scanline filter the encoder chose. PNG spec, filter types 0-4. */
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp
  const out = Buffer.alloc(height * stride)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const type = raw[pos++]
    const line = raw.subarray(pos, pos + stride)
    pos += stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null

    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= bpp ? prev[x - bpp] : 0
      let value = line[x]
      if (type === 1) value += a
      else if (type === 2) value += b
      else if (type === 3) value += (a + b) >> 1
      else if (type === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (type !== 0) throw new Error(`unknown filter type ${type} on row ${y}`)
      cur[x] = value & 0xff
    }
  }
  return out
}

/**
 * Box filter: every output pixel is the mean of the source block it covers.
 * Alpha is premultiplied before averaging, or the colour of transparent pixels
 * bleeds into the edges of the mark as a grey halo.
 */
function resize(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4)
  const xr = sw / dw
  const yr = sh / dh
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * yr)
    const y1 = Math.min(sh, Math.ceil((y + 1) * yr))
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * xr)
      const x1 = Math.min(sw, Math.ceil((x + 1) * xr))
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * sw + sx) * 4
          const alpha = src[i + 3] / 255
          r += src[i] * alpha
          g += src[i + 1] * alpha
          b += src[i + 2] * alpha
          a += src[i + 3]
          n++
        }
      }
      const o = (y * dw + x) * 4
      const meanA = a / n
      const unpremultiply = meanA > 0 ? 255 / meanA : 0
      out[o] = Math.min(255, Math.round((r / n) * unpremultiply))
      out[o + 1] = Math.min(255, Math.round((g / n) * unpremultiply))
      out[o + 2] = Math.min(255, Math.round((b / n) * unpremultiply))
      out[o + 3] = Math.round(meanA)
    }
  }
  return out
}

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (~c) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encode(pixels, width, height) {
  const stride = width * 4
  // Filter type 0 on every row: the image is small and zlib does the work.
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  return Buffer.concat([
    PNG_MAGIC,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const [file, sizeArg] = process.argv.slice(2)
if (!file || !sizeArg) {
  console.error('Usage: node scripts/resize-png.mjs <file.png> <max-edge>')
  process.exit(1)
}
const target = Number(sizeArg)

const input = readFileSync(file)
const chunks = readChunks(input)
const ihdr = chunks.find((c) => c.type === 'IHDR').data
const width = ihdr.readUInt32BE(0)
const height = ihdr.readUInt32BE(4)
const depth = ihdr[8]
const colour = ihdr[9]
const interlace = ihdr[12]

if (depth !== 8 || colour !== 6 || interlace !== 0) {
  console.error(
    `Refusing: this handles 8-bit RGBA non-interlaced only, and this file is depth ${depth}, colour type ${colour}, interlace ${interlace}.`,
  )
  process.exit(1)
}

const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data))
const pixels = unfilter(inflateSync(idat), width, height, 4)

const scale = target / Math.max(width, height)
const dw = Math.max(1, Math.round(width * scale))
const dh = Math.max(1, Math.round(height * scale))
const out = encode(resize(pixels, width, height, dw, dh), dw, dh)

writeFileSync(file, out)
console.log(
  `${file}: ${width}×${height} ${input.length} bytes → ${dw}×${dh} ${out.length} bytes ` +
    `(${Math.round((1 - out.length / input.length) * 100)}% smaller)`,
)
