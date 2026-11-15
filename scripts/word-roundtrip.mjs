// Prints whether two files are byte-for-byte identical, by SHA-256.
//   node scripts/word-roundtrip.mjs "<original.docx>" "<downloaded.docx>"
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const [a, b] = process.argv.slice(2)
if (!a || !b) {
  console.error('Usage: node scripts/word-roundtrip.mjs <original> <download>')
  process.exit(2)
}
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const [x, y] = [sha(a), sha(b)]
console.log(`${x}  ${a}\n${y}  ${b}`)
console.log(x === y ? 'identical' : 'different')
process.exit(x === y ? 0 : 1)
