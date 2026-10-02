/** Whether this browser can record at all. */
export function canRecordVoice() {
  return typeof window !== 'undefined' && 'MediaRecorder' in window && Boolean(navigator.mediaDevices?.getUserMedia)
}

/** 84000 -> "1:24". */
export function clock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const VOICE_NAME = /^Voice message \((\d+:\d{2})\)/

/** A chat attachment that is a recorded voice message, named for its length. */
export function voiceFileName(ms: number, type: string) {
  const base = type.split(';')[0]
  const ext = base === 'audio/mp4' ? 'm4a' : base === 'audio/ogg' ? 'ogg' : 'webm'
  return `Voice message (${clock(ms)}).${ext}`
}

/** "1:24" for a voice message attachment, null for any other file. */
export function voiceLength(fileName: string, mimeType: string | null) {
  if (!(mimeType ?? '').startsWith('audio/')) return null
  return VOICE_NAME.exec(fileName)?.[1] ?? null
}
