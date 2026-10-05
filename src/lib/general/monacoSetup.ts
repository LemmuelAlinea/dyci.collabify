/**
 * Monaco — the editor inside VS Code — bundled with the site.
 *
 * Imported only by the code editor, which itself loads on demand, so nobody
 * pays for it until they open a code file. Bundled rather than fetched from a
 * CDN: the site's content security policy allows scripts from itself only.
 */
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

type MonacoEnvironment = { getWorker: (id: string, label: string) => Worker }

;(self as unknown as { MonacoEnvironment: MonacoEnvironment }).MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  },
}

const ts = monaco.typescript
const compilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  jsx: ts.JsxEmit.ReactJSX,
  allowJs: true,
  allowNonTsExtensions: true,
  esModuleInterop: true,
  skipLibCheck: true,
}

/*
 * The editor sees one file, not the project around it: no node_modules, no
 * sibling files, no JSX types. So "cannot find module" and the errors that
 * follow from a missing React are noise, not mistakes in the file. Everything
 * else — broken syntax, a string where a number goes, a misspelt local — is
 * reported the way VS Code reports it.
 */
const diagnosticCodesToIgnore = [
  2307, // Cannot find module
  2792, // Cannot find module; did you mean to set moduleResolution
  7016, // Could not find a declaration file for module
  2875, // JSX tag requires the module path 'react/jsx-runtime'
  7026, // JSX element implicitly has type 'any'
  2686, // 'React' refers to a UMD global
  2580, // Cannot find name 'require' or 'process' (Node types)
  2591, // Cannot find name; install @types/node
]

ts.typescriptDefaults.setCompilerOptions(compilerOptions)
ts.javascriptDefaults.setCompilerOptions(compilerOptions)
ts.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false, diagnosticCodesToIgnore })
ts.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false, diagnosticCodesToIgnore })

export { monaco }
