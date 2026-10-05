/**
 * Syntax errors for languages Monaco only colours.
 *
 * Each grammar is a Lezer parser of a few dozen kilobytes, fetched the first
 * time a file in that language opens. Lezer recovers from mistakes by putting
 * error nodes in the tree; every one of them is a place the code does not
 * parse, which is exactly the red squiggle somebody expects from VS Code.
 * This finds broken syntax only — not a misspelt name or a wrong type.
 */
import type { Parser, Tree } from '@lezer/common'
import type { SyntaxGrammar } from './codeLanguage'

export type SyntaxProblem = { from: number; to: number; message: string }

const GRAMMARS: Record<SyntaxGrammar, () => Promise<Parser>> = {
  python: () => import('@lezer/python').then((m) => m.parser),
  java: () => import('@lezer/java').then((m) => m.parser),
  cpp: () => import('@lezer/cpp').then((m) => m.parser),
  php: () => import('@lezer/php').then((m) => m.parser),
  rust: () => import('@lezer/rust').then((m) => m.parser),
  go: () => import('@lezer/go').then((m) => m.parser),
}

/** More than this and the first ones are what matters; the rest are usually echoes. */
const LIMIT = 100

export async function findSyntaxErrors(code: string, grammar: SyntaxGrammar): Promise<SyntaxProblem[]> {
  const parser = await GRAMMARS[grammar]()
  return errorsInTree(parser.parse(code), code)
}

export function errorsInTree(tree: Tree, code: string): SyntaxProblem[] {
  const out: SyntaxProblem[] = []
  tree.iterate({
    enter(node) {
      if (out.length >= LIMIT) return false
      if (!node.type.isError) return
      // Recovery often leaves several error nodes on one spot; one squiggle is enough.
      const last = out[out.length - 1]
      if (last && node.from <= last.to) return
      out.push({ from: node.from, to: Math.max(node.to, node.from), message: describe(code, node.from, node.to) })
    },
  })
  return out
}

function describe(code: string, from: number, to: number) {
  if (from >= code.length) return 'Syntax error: the file ends before this is finished.'
  const text = code.slice(from, to).trim() || code.slice(from).match(/^\s*(\S+)/)?.[1]
  if (!text || code[from] === '\n') return 'Syntax error at the end of this line.'
  const shown = text.length > 24 ? `${text.slice(0, 24)}…` : text
  return `Syntax error near “${shown}”.`
}
