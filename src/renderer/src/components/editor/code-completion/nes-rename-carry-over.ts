import type { editor } from 'monaco-editor'
import { translate } from '@/i18n/i18n'
import type { NesEdit } from '../../../../../shared/code-completion/code-completion-types'

/**
 * How long the file has to be still before a rename is carried over.
 *
 * Why: a name that is being typed changes with every keystroke, and each of those is a rename
 * from one half-written name to the next. The pause lets the name settle first.
 */
export const NES_RENAME_SETTLE_MS = 900

/** A name that is too short is a letter or a variable, and carrying it over helps nobody. */
export const NES_RENAME_MIN_LENGTH = 3

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export type NesRename = {
  /** The name that was there before. */
  from: string
  /** The name the person wrote. */
  to: string
}

/**
 * The name a line's change renamed, or null.
 *
 * Why the names are compared and not the characters: a character diff of "foo" and "foobar" says
 * that one letter became four, and the name that was renamed is lost. A line holds the names it
 * has, and the one that changed is the rename.
 */
export function nesRenamedWord(oldLine: string, newLine: string): NesRename | null {
  if (oldLine === newLine) {
    return null
  }
  const before = identifiersOf(oldLine)
  const after = identifiersOf(newLine)
  if (before.length !== after.length) {
    // Why: a line that gained or lost a name says nothing about which name was renamed.
    return null
  }
  for (let index = 0; index < before.length; index += 1) {
    const from = before[index]
    const to = after[index]
    if (from === to) {
      continue
    }
    if (!isRenameName(from) || !isRenameName(to)) {
      return null
    }
    return { from, to }
  }
  return null
}

/** The names a line holds, in the order they appear. */
function identifiersOf(line: string): string[] {
  return [...line.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)].map((match) => match[0])
}

function isRenameName(name: string): boolean {
  return name.length >= NES_RENAME_MIN_LENGTH && IDENTIFIER.test(name)
}

/**
 * The places in the file where the old name is still used, after the cursor.
 *
 * Why only the whole word: a name that is part of a longer one is a different name.
 */
export function nesRenameOccurrences(
  model: editor.ITextModel,
  name: string,
  afterLine: number
): { line: number; column: number; endColumn: number }[] {
  const found: { line: number; column: number; endColumn: number }[] = []
  for (let line = afterLine; line <= model.getLineCount(); line += 1) {
    const content = model.getLineContent(line)
    let index = content.indexOf(name)
    while (index !== -1) {
      const before = index === 0 ? '' : content[index - 1]
      const after = content[index + name.length] ?? ''
      if (!isWordCharacter(before) && !isWordCharacter(after)) {
        found.push({ line, column: index + 1, endColumn: index + name.length + 1 })
      }
      index = content.indexOf(name, index + 1)
    }
  }
  return found
}

function isWordCharacter(character: string): boolean {
  return /[A-Za-z0-9_$]/.test(character)
}

/**
 * The edit that carries the rename over to the next place the old name is used.
 *
 * Why one place at a time: the person sees what the change does before the next one is offered.
 */
export function nesRenameEdit(
  model: editor.ITextModel,
  rename: NesRename,
  occurrence: { line: number; column: number; endColumn: number },
  filePath: string
): NesEdit | null {
  const covered = model
    .getLineContent(occurrence.line)
    .slice(occurrence.column - 1, occurrence.endColumn - 1)
  if (covered !== rename.from) {
    return null
  }
  return {
    id: `rename-${occurrence.line}-${occurrence.column}`,
    path: filePath,
    kind: 'replace',
    range: {
      startLine: occurrence.line,
      startColumn: occurrence.column,
      endLine: occurrence.line,
      endColumn: occurrence.endColumn
    },
    originalText: rename.from,
    text: rename.to,
    label: translate(
      'auto.components.editor.codeCompletion.rename-label',
      'Rename {{value0}} to {{value1}}',
      { value0: rename.from, value1: rename.to }
    )
  }
}

export type NesRenameCarryOverWatcher = {
  /** Stops watching the file. */
  dispose: () => void
}

/**
 * Watches the file for a rename and offers the next place the old name is used.
 *
 * Why the file is watched and not the model: a rename is a change of the text, and the text is
 * what says which name was replaced by which.
 *
 * Why a baseline is kept per line: the editor does not say what the line held before the change,
 * and a name that is typed one letter at a time can only be read against the line as it was
 * before the typing began.
 */
export function createNesRenameCarryOverWatcher(params: {
  editorInstance: editor.IStandaloneCodeEditor
  filePath: string
  /** The places the rename is carried over to. */
  onCarryOver: (edits: NesEdit[]) => void
}): NesRenameCarryOverWatcher {
  /** The text of the lines as they were before the current burst of changes. */
  const baselines = new Map<number, string>()
  /** The lines the current burst of changes touched. */
  const touched = new Set<number>()
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let candidate: NesRename | null = null

  const clearSettleTimer = (): void => {
    if (settleTimer !== null) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
  }

  const seedBaseline = (): void => {
    const model = params.editorInstance.getModel()
    const position = params.editorInstance.getPosition()
    if (!model || !position) {
      return
    }
    const line = position.lineNumber
    if (!baselines.has(line)) {
      baselines.set(line, model.getLineContent(line))
    }
  }

  const propose = (): void => {
    settleTimer = null
    const rename = candidate
    candidate = null
    const model = params.editorInstance.getModel()
    const position = params.editorInstance.getPosition()
    if (rename && model && position) {
      const next = nesRenameOccurrences(model, rename.from, position.lineNumber)[0]
      const edit = next ? nesRenameEdit(model, rename, next, params.filePath) : null
      if (edit) {
        params.onCarryOver([edit])
      }
    }
    // Why: the burst is over, so the lines it touched start again from what they hold now.
    for (const line of touched) {
      const model = params.editorInstance.getModel()
      if (model && line <= model.getLineCount()) {
        baselines.set(line, model.getLineContent(line))
      }
    }
    touched.clear()
  }

  const contentSubscription = params.editorInstance.onDidChangeModelContent((event) => {
    const model = params.editorInstance.getModel()
    if (!model) {
      return
    }
    // Why: an editor that does not say which lines changed leaves the watcher with nothing to
    // compare, and a rename that cannot be seen is a rename that is not carried over.
    for (const change of event?.changes ?? []) {
      const line = change.range.startLineNumber
      touched.add(line)
      const before = baselines.get(line)
      if (before === undefined) {
        continue
      }
      const renamed = nesRenamedWord(before, model.getLineContent(line))
      if (!renamed) {
        continue
      }
      candidate = renamed
      clearSettleTimer()
      settleTimer = setTimeout(propose, NES_RENAME_SETTLE_MS)
    }
  })

  const cursorSubscription = params.editorInstance.onDidChangeCursorPosition(seedBaseline)

  seedBaseline()

  return {
    dispose(): void {
      clearSettleTimer()
      contentSubscription.dispose()
      cursorSubscription.dispose()
    }
  }
}
