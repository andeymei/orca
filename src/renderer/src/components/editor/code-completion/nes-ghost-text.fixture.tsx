import { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import '@/lib/editor/monaco/monaco-setup'
import { defineFixture } from '../../../component-fixtures/component-fixture'
import { MONACO_INLINE_SUGGEST_OPTIONS } from '../monaco-inline-suggest-options'

const SOURCE = 'const a = 1\nconst b = 2\n'
const PROBE_SELECTOR = '[data-testid="nes-ghost-text-probe"]'

let mountedEditor: monaco.editor.IStandaloneCodeEditor | null = null

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return true
    }
    await sleep(50)
  }
  return predicate()
}

/** What the editor put on the screen, read from the DOM the user would see. */
function readDom(): Record<string, unknown> {
  const decorations = Array.from(
    document.querySelectorAll('.ghost-text-decoration, .ghost-text-decoration-preview')
  )
  return {
    ghostTextDecoration: decorations.length,
    suggestWidget: document.querySelectorAll('.suggest-widget').length,
    suggestFocused: document.querySelectorAll('.suggest-widget .monaco-list-row.focused').length,
    text: decorations.map((node) => node.textContent ?? '').join(' | ') || '(nothing drawn)'
  }
}

function NesGhostTextProbe(): React.ReactElement {
  const [, setProbe] = useState(0)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

  useEffect(() => {
    // The next-edit provider: an insert at the cursor, which is what the editor can draw.
    const inlineProvider = monaco.languages.registerInlineCompletionsProvider('*', {
      provideInlineCompletions: (model, position) => {
        const column = model.getLineMaxColumn(position.lineNumber)
        return {
          items: [
            {
              insertText: 'const c = 3\n',
              range: {
                startLineNumber: position.lineNumber,
                startColumn: column,
                endLineNumber: position.lineNumber,
                endColumn: column
              }
            }
          ]
        }
      },
      disposeInlineCompletions: () => {}
    })
    // A word-completion provider, so the suggest widget holds a focused item without a worker.
    const suggestProvider = monaco.languages.registerCompletionItemProvider('*', {
      provideCompletionItems: (model, position) => ({
        suggestions: [
          {
            label: 'const d = 4',
            kind: monaco.languages.CompletionItemKind.Variable,
            insertText: 'const d = 4',
            range: {
              startLineNumber: position.lineNumber,
              startColumn: model.getLineMaxColumn(position.lineNumber),
              endLineNumber: position.lineNumber,
              endColumn: model.getLineMaxColumn(position.lineNumber)
            }
          }
        ]
      })
    })
    return () => {
      inlineProvider.dispose()
      suggestProvider.dispose()
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Editor
        height={140}
        defaultLanguage="typescript"
        defaultValue={SOURCE}
        options={MONACO_INLINE_SUGGEST_OPTIONS}
        onMount={(editor) => {
          editorRef.current = editor
          mountedEditor = editor
        }}
      />
      <pre data-testid="nes-ghost-text-probe" style={{ fontSize: 12, color: '#111' }}>
        (probing…)
      </pre>
      <button type="button" onClick={() => setProbe((value) => value + 1)}>
        re-read
      </button>
    </div>
  )
}

/**
 * Puts the cursor where a suggestion would land, optionally opens the suggest widget, and
 * records what the editor drew.
 */
async function probe(frame: HTMLElement, options: { openSuggestWidget: boolean }): Promise<void> {
  await waitFor(() => mountedEditor !== null, 10_000)
  const editor = mountedEditor
  const model = editor?.getModel()
  if (!editor || !model) {
    throw new Error('The editor did not mount.')
  }
  editor.updateOptions(MONACO_INLINE_SUGGEST_OPTIONS)
  editor.setPosition({ lineNumber: 2, column: model.getLineMaxColumn(2) })
  editor.focus()
  await sleep(300)
  if (options.openSuggestWidget) {
    // Why: the suggest widget opens on a real keystroke, which the harness sends; the probe
    // waits for it to hold a focused item, which is the state the plan lands in.
    await editor.getAction('editor.action.triggerSuggest')?.run()
    await sleep(1200)
  }
  // Why: Monaco only asks the provider after the model changed, so the suggestion is triggered
  // the way a keystroke would have triggered it.
  await editor.getAction('editor.action.inlineSuggest.trigger')?.run()
  await sleep(800)
  const target = frame.querySelector(PROBE_SELECTOR)
  if (target) {
    target.textContent = JSON.stringify(readDom(), null, 2)
  }
  await sleep(100)
}

export const plain = defineFixture({
  width: 700,
  render: () => <NesGhostTextProbe />,
  interact: (frame) => probe(frame, { openSuggestWidget: false })
})

export const withSuggestWidget = defineFixture({
  width: 700,
  render: () => <NesGhostTextProbe />,
  interact: (frame) => probe(frame, { openSuggestWidget: true })
})
