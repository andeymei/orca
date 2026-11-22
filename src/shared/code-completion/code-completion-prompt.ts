import {
  NES_IMPORT_LABEL_PREFIX,
  NES_MAX_EDITS,
  NES_MAX_EDITS_PER_FILE,
  type NesPromptInput,
  type NesRequest
} from './code-completion-types'

export const NES_CURSOR_MARKER = '<<<CURSOR>>>'
export const NES_PATH_HEADER_PREFIX = '###PATH: '

const NES_PATH_MARKER = NES_PATH_HEADER_PREFIX.trimEnd()

const AUTO_IMPORT_RULE = `When the new code needs a module that is not imported, propose an \`insert\` edit at the top of the file that adds the import, and give the edit the label \`${NES_IMPORT_LABEL_PREFIX}<what it imports>\`.`

export function buildNesSystemPrompt(options?: { autoImport?: boolean }): string {
  const lines = [
    'You are a code completion assistant that edits the file the user is typing in.',
    'Reply with a single JSON object of the form {"edits":[…]} and nothing else: no prose, no markdown fence.',
    'Every edit carries id, path, kind, range, originalText, text and label: kind is insert or replace, and range is {startLine, startColumn, endLine, endColumn}.',
    'An insert carries an empty originalText, and a replace carries both.',
    'Only propose paths that appear in the context you are given.',
    `Answer with each path exactly as it appears after \`${NES_PATH_MARKER}\`, so the edit is not dropped.`,
    `Propose at most ${NES_MAX_EDITS} edits, and at most ${NES_MAX_EDITS_PER_FILE} edits per file.`,
    'A range is 1-based, its columns count UTF-16 code units, and it covers the text up to but not including its end.',
    "An edit's range must be on one line.",
    `Count each file's lines separately — the first line of a file's content, the line right after its \`${NES_PATH_MARKER}\` header, is line 1 of that file.`,
    `The cursor is marked with \`${NES_CURSOR_MARKER}\` in the file content.`,
    `The cursor marker \`${NES_CURSOR_MARKER}\` starts at the cursor and occupies the ${NES_CURSOR_MARKER.length} columns after it, so a column past the marker is ${NES_CURSOR_MARKER.length} larger than the file's column.`,
    'The edit at the cursor must end at the cursor position, so the suggestion applies where the user is typing.',
    'Prefer the edit at the cursor: an insert that adds what comes next after the text the cursor sits at the end of.',
    'Only when there is nothing to add at the cursor, propose the next edit elsewhere in the file.',
    'originalText must be the exact text the range currently covers.',
    "An edit's text replaces the text its range covers; an insert carries an empty originalText.",
    'label is a short human-readable intent.',
    'When you have nothing to propose, answer {"edits":[]}.'
  ]
  if (options?.autoImport) {
    lines.push(AUTO_IMPORT_RULE)
  }
  return lines.join('\n')
}

export function buildNesUserPrompt(input: NesPromptInput): string {
  // Why: the model counts the content it is shown from its first line, so the cursor's line is
  // counted from there. Naming the position saves it from counting lines and columns itself,
  // and an edit it cannot place is an edit the editor cannot draw.
  const cursorLineInContent = input.cursorLine - input.prefixStartLine + 1
  const sections = [
    `Current file: ${input.relativePath}`,
    `Language: ${input.languageId}`,
    `Cursor: line ${cursorLineInContent}, column ${input.cursorColumn} of the file below, counting its first line as line 1.`,
    '',
    `${NES_PATH_HEADER_PREFIX}${input.filePath}`,
    `${input.prefix}${NES_CURSOR_MARKER}${input.suffix}`
  ]
  for (const relatedFile of input.relatedFiles) {
    sections.push('', `${NES_PATH_HEADER_PREFIX}${relatedFile.path}`, relatedFile.content)
  }
  if (input.recentEdits.length > 0) {
    sections.push('', 'Recently accepted edits:')
    for (const recentEdit of input.recentEdits) {
      sections.push(`- ${recentEdit.path}: ${recentEdit.label}`)
    }
  }
  return sections.join('\n')
}

/**
 * The prompt of the inline mode: the model is a completion engine, so it answers with the text
 * to insert and nothing else.
 *
 * Why so little: every field the model has to fill is a field it can get wrong. A line number it
 * miscounts puts the edit in the wrong place, and a range it names wrong is an edit the editor
 * cannot draw at all. Asking only for text leaves nothing to get wrong.
 */
export function buildNesInlineSystemPrompt(): string {
  return [
    'You are a code completion engine.',
    `The user sends a file with ${NES_CURSOR_MARKER} marking the cursor.`,
    'Reply with ONLY the text to insert at the cursor: usually the rest of the current line or statement, or a short block when the cursor sits in an empty body.',
    "Stop where the cursor's statement ends: never write code that belongs after it, and never repeat code that is already before or after the cursor.",
    'No explanation and no markdown fences.',
    'Reply with nothing if unsure.'
  ].join(' ')
}

/**
 * The user's half of the inline prompt: the file, the language, and the text around the cursor.
 *
 * Why the cursor is marked rather than described: a model that has to count lines to find the
 * cursor answers about the wrong line, and the answer is then about text the user never typed.
 */
export function buildNesInlineUserPrompt(input: NesRequest): string {
  const language = input.languageId ? ` (${input.languageId})` : ''
  return `File: ${input.relativePath}${language}\n\n${input.prefix}${NES_CURSOR_MARKER}${input.suffix}`
}
