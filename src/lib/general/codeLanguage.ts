/**
 * Which language a text file is written in, for the code editor.
 *
 * `monaco` is the id Monaco colours it with. `grammar` names the Lezer parser
 * that finds its syntax errors, for the languages Monaco has no checker for;
 * TypeScript, JavaScript, JSON, CSS and HTML are checked by Monaco itself.
 */
import { extensionOf, fileName } from './files'

export type SyntaxGrammar = 'python' | 'java' | 'cpp' | 'php' | 'rust' | 'go'

export type CodeLanguage = { monaco: string; label: string; grammar?: SyntaxGrammar }

const BY_EXTENSION: Record<string, CodeLanguage> = {
  ts: { monaco: 'typescript', label: 'TypeScript' },
  tsx: { monaco: 'typescript', label: 'TypeScript JSX' },
  js: { monaco: 'javascript', label: 'JavaScript' },
  mjs: { monaco: 'javascript', label: 'JavaScript' },
  cjs: { monaco: 'javascript', label: 'JavaScript' },
  jsx: { monaco: 'javascript', label: 'JavaScript JSX' },
  json: { monaco: 'json', label: 'JSON' },
  html: { monaco: 'html', label: 'HTML' },
  vue: { monaco: 'html', label: 'Vue' },
  svelte: { monaco: 'html', label: 'Svelte' },
  css: { monaco: 'css', label: 'CSS' },
  scss: { monaco: 'scss', label: 'SCSS' },
  less: { monaco: 'less', label: 'Less' },
  py: { monaco: 'python', label: 'Python', grammar: 'python' },
  java: { monaco: 'java', label: 'Java', grammar: 'java' },
  c: { monaco: 'c', label: 'C', grammar: 'cpp' },
  h: { monaco: 'c', label: 'C header', grammar: 'cpp' },
  cpp: { monaco: 'cpp', label: 'C++', grammar: 'cpp' },
  cc: { monaco: 'cpp', label: 'C++', grammar: 'cpp' },
  hpp: { monaco: 'cpp', label: 'C++ header', grammar: 'cpp' },
  hh: { monaco: 'cpp', label: 'C++ header', grammar: 'cpp' },
  cs: { monaco: 'csharp', label: 'C#' },
  php: { monaco: 'php', label: 'PHP', grammar: 'php' },
  go: { monaco: 'go', label: 'Go', grammar: 'go' },
  rs: { monaco: 'rust', label: 'Rust', grammar: 'rust' },
  rb: { monaco: 'ruby', label: 'Ruby' },
  kt: { monaco: 'kotlin', label: 'Kotlin' },
  kts: { monaco: 'kotlin', label: 'Kotlin' },
  swift: { monaco: 'swift', label: 'Swift' },
  dart: { monaco: 'dart', label: 'Dart' },
  scala: { monaco: 'scala', label: 'Scala' },
  lua: { monaco: 'lua', label: 'Lua' },
  r: { monaco: 'r', label: 'R' },
  pl: { monaco: 'perl', label: 'Perl' },
  sql: { monaco: 'sql', label: 'SQL' },
  graphql: { monaco: 'graphql', label: 'GraphQL' },
  gql: { monaco: 'graphql', label: 'GraphQL' },
  sh: { monaco: 'shell', label: 'Shell' },
  ps1: { monaco: 'powershell', label: 'PowerShell' },
  bat: { monaco: 'bat', label: 'Batch' },
  yml: { monaco: 'yaml', label: 'YAML' },
  yaml: { monaco: 'yaml', label: 'YAML' },
  xml: { monaco: 'xml', label: 'XML' },
  toml: { monaco: 'ini', label: 'TOML' },
  ini: { monaco: 'ini', label: 'INI' },
  cfg: { monaco: 'ini', label: 'Config' },
  conf: { monaco: 'ini', label: 'Config' },
  properties: { monaco: 'ini', label: 'Properties' },
  env: { monaco: 'ini', label: 'Environment' },
  gradle: { monaco: 'java', label: 'Gradle' },
  md: { monaco: 'markdown', label: 'Markdown' },
  markdown: { monaco: 'markdown', label: 'Markdown' },
}

const BY_NAME: Record<string, CodeLanguage> = {
  dockerfile: { monaco: 'dockerfile', label: 'Dockerfile' },
  makefile: { monaco: 'plaintext', label: 'Makefile' },
}

const PLAIN: CodeLanguage = { monaco: 'plaintext', label: 'Plain text' }

export function codeLanguage(path: string): CodeLanguage {
  return BY_EXTENSION[extensionOf(path)] ?? BY_NAME[fileName(path).toLowerCase()] ?? PLAIN
}
