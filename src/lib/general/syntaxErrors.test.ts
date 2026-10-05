import { describe, expect, it } from 'vitest'
import { findSyntaxErrors } from './syntaxErrors'
import { codeLanguage } from './codeLanguage'

describe('findSyntaxErrors', () => {
  it('passes valid Python', async () => {
    expect(await findSyntaxErrors('def greet(name):\n    print(name)\n', 'python')).toEqual([])
  })

  it('finds a missing colon in Python', async () => {
    const code = 'def greet(name)\n    print(name)\n'
    const found = await findSyntaxErrors(code, 'python')
    expect(found.length).toBeGreaterThan(0)
    expect(found[0].from).toBeLessThanOrEqual(code.indexOf('\n') + 1)
  })

  it('finds a missing semicolon in Java', async () => {
    const ok = 'class A { void f() { int x = 1; } }'
    expect(await findSyntaxErrors(ok, 'java')).toEqual([])
    expect((await findSyntaxErrors('class A { void f() { int x = 1 } }', 'java')).length).toBeGreaterThan(0)
  })

  it('finds an unclosed brace in C++', async () => {
    expect(await findSyntaxErrors('int main() { return 0; }', 'cpp')).toEqual([])
    expect((await findSyntaxErrors('int main() { return 0;', 'cpp')).length).toBeGreaterThan(0)
  })

  it('reads PHP, Rust and Go', async () => {
    expect(await findSyntaxErrors('<?php echo "hi"; ?>', 'php')).toEqual([])
    expect(await findSyntaxErrors('fn main() { let x = 1; }', 'rust')).toEqual([])
    expect(await findSyntaxErrors('package main\nfunc main() {}\n', 'go')).toEqual([])
    expect((await findSyntaxErrors('fn main() { let x = ; }', 'rust')).length).toBeGreaterThan(0)
  })
})

describe('codeLanguage', () => {
  it('maps extensions to Monaco ids and grammars', () => {
    expect(codeLanguage('src/App.tsx')).toMatchObject({ monaco: 'typescript' })
    expect(codeLanguage('a/b/main.PY')).toMatchObject({ monaco: 'python', grammar: 'python' })
    expect(codeLanguage('lib/x.h')).toMatchObject({ monaco: 'c', grammar: 'cpp' })
    expect(codeLanguage('Dockerfile')).toMatchObject({ monaco: 'dockerfile' })
    expect(codeLanguage('notes.txt')).toMatchObject({ monaco: 'plaintext' })
  })
})
