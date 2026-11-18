import {
  NES_IMPORT_LABEL_PREFIX,
  NES_MAX_EDITS,
  NES_MAX_EDITS_PER_FILE,
  type NesPromptInput
} from './code-completion-types'

export const NES_CURSOR_MARKER = '<<<CURSOR>>>'
export const NES_PATH_HEADER_PREFIX = '###PATH: '

const NES_PATH_MARKER = NES_PATH_HEADER_PREFIX.trimEnd()

const AUTO_IMPORT_RULE = `When the new code needs a module that is not imported, propose an \`insert\` edit at the top of the file that adds the import, and give the edit the label \`${NES_IMPORT_LABEL_PREFIX}<what it imports>\`.`

export function buildNesSystemPrompt(options?: { autoImport?: boolean }): string {
  const lines = [
    'You are a code completion assistant that edits the file the user is typing in.',
    'Reply with a single JSON object of the form {"edits":[…]} and nothing else: no prose, no markdown fence.',
    'Every edit carries id, path, kind, range, originalText, text and label: kind is insert, replace or delete, and range is {startLine, startColumn, endLine, endColumn}.',
    'An insert carries an empty originalText, a delete carries an empty text, and a replace carries both.',
    'Only propose paths that appear in the context you are given.',
    `Answer with each path exactly as it appears after \`${NES_PATH_MARKER}\`, so the edit is not dropped.`,
    `Propose at most ${NES_MAX_EDITS} edits, and at most ${NES_MAX_EDITS_PER_FILE} edits per file.`,
    'A range is 1-based, its columns count UTF-16 code units, and it covers the text up to but not including its end.',
    `Count each file's lines separately — the first line of a file's content, the line right after its \`${NES_PATH_MARKER}\` header, is line 1 of that file.`,
    `The cursor is marked with \`${NES_CURSOR_MARKER}\` in the file content.`,
    `The cursor marker \`${NES_CURSOR_MARKER}\` occupies ${NES_CURSOR_MARKER.length} columns of the content, so count those columns when you answer; the cursor is at the marker.`,
    'The edit at the cursor must end at the cursor position, so the suggestion applies where the user is typing.',
    'originalText must be the exact text the range currently covers.',
    'label is a short human-readable intent.',
    'When you have nothing to propose, answer {"edits":[]}.'
  ]
  if (options?.autoImport) {
    lines.push(AUTO_IMPORT_RULE)
  }
  return lines.join('\n')
}

export function buildNesUserPrompt(input: NesPromptInput): string {
  const sections = [
    `Current file: ${input.relativePath}`,
    `Language: ${input.languageId}`,
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
