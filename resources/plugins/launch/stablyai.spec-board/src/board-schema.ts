// A hand-written validator for the snapshot the agent writes to disk. No schema library: the
// validator itself has to name the field it is rejecting, because the panel shows that message
// to the user when a snapshot is broken.

import type {
  BoardSnapshot,
  OpenspecFacts,
  SnapshotItem,
  SnapshotProject,
  SuperpowersFacts,
  VerificationFacts
} from './model'
import { isRecord } from './unknown-values'

export type ParseResult = { ok: true; value: BoardSnapshot } | { ok: false; error: string }

/** A rejection, carrying the message the panel shows. */
class SnapshotFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SnapshotFailure'
  }
}

function fail(field: string, problem: string): never {
  throw new SnapshotFailure(`${field}: ${problem}`)
}

function isFailure(error: unknown): error is SnapshotFailure {
  return error instanceof SnapshotFailure
}

const OPENSPEC_STAGE_VALUES: readonly OpenspecFacts['stage'][] = [
  'proposed',
  'implementing',
  'validated',
  'archived'
]

const SUPERPOWERS_STAGE_VALUES: readonly SuperpowersFacts['stage'][] = [
  'designed',
  'planned',
  'executing',
  'done'
]

function readObject(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(field, '期望对象')
  }
  return value
}

function readArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(field, '期望数组')
  }
  return value
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    fail(field, '期望字符串')
  }
  return value
}

function readNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(field, '期望非空字符串')
  }
  return value
}

/** An optional field: absent and null both mean "not written". */
function readOptionalString(value: unknown, field: string): string | undefined {
  return readNullableString(value, field) ?? undefined
}

/** A field whose type allows null: there null is a value, not an absence. */
function readNullableString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null
  }
  return readString(value, field)
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    fail(field, '期望布尔值')
  }
  return value
}

function readCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(field, '期望非负整数')
  }
  return value
}

function readStringArray(value: unknown, field: string): string[] {
  return readArray(value, field).map((entry, index) => readString(entry, `${field}[${index}]`))
}

/** An optional field: absent and null both mean "not written". */
function readOptionalStringArray(value: unknown, field: string): string[] | undefined {
  return value === undefined || value === null ? undefined : readStringArray(value, field)
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  const found = allowed.find((entry) => entry === value)
  if (found === undefined) {
    fail(field, `期望 ${allowed.join(' | ')}`)
  }
  return found
}

/** A timestamp the panel may not be able to read: an unreadable one reads as unknown, not as a broken snapshot. */
function readTime(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNullable<T>(
  value: unknown,
  field: string,
  read: (value: unknown, field: string) => T
): T | null {
  if (value === undefined || value === null) {
    return null
  }
  return read(value, field)
}

function readGeneratedBy(value: unknown, field: string): BoardSnapshot['generatedBy'] {
  const source = readObject(value, field)
  const agent = readNonEmptyString(source['agent'], `${field}.agent`)
  const workspace = readOptionalString(source['workspace'], `${field}.workspace`)
  const host = readOptionalString(source['host'], `${field}.host`)
  return {
    agent,
    ...(workspace === undefined ? {} : { workspace }),
    ...(host === undefined ? {} : { host })
  }
}

function readOpenspecFacts(value: unknown, field: string): OpenspecFacts {
  const source = readObject(value, field)
  const changeId = readNonEmptyString(source['changeId'], `${field}.changeId`)
  const stage = readEnum(source['stage'], OPENSPEC_STAGE_VALUES, `${field}.stage`)
  const hasProposal = readBoolean(source['hasProposal'], `${field}.hasProposal`)
  const hasDesign = readBoolean(source['hasDesign'], `${field}.hasDesign`)
  const hasTasks = readBoolean(source['hasTasks'], `${field}.hasTasks`)
  const tasksDone = readCount(source['tasksDone'], `${field}.tasksDone`)
  const tasksInProgress = readCount(source['tasksInProgress'], `${field}.tasksInProgress`)
  const tasksTotal = readCount(source['tasksTotal'], `${field}.tasksTotal`)
  if (tasksDone > tasksTotal) {
    fail(`${field}.tasksDone`, `期望不大于 tasksTotal（当前 ${tasksTotal}）`)
  }
  if (tasksDone + tasksInProgress > tasksTotal) {
    fail(
      `${field}.tasksInProgress`,
      `期望 tasksDone + tasksInProgress 不大于 tasksTotal（当前 ${tasksDone} + ${tasksInProgress} > ${tasksTotal}）`
    )
  }
  const capabilities = readStringArray(source['capabilities'], `${field}.capabilities`)
  return {
    changeId,
    stage,
    hasProposal,
    hasDesign,
    hasTasks,
    tasksDone,
    tasksInProgress,
    tasksTotal,
    capabilities
  }
}

/** The verification records a snapshot carries: the rounds, how many passed, the last verdict. */
function readVerificationFacts(value: unknown, field: string): VerificationFacts {
  const source = readObject(value, field)
  const rounds = readCount(source['rounds'], `${field}.rounds`)
  const passed = readCount(source['passed'], `${field}.passed`)
  const lastPassed = readNullable(source['lastPassed'], `${field}.lastPassed`, readBoolean)
  if (passed > rounds) {
    fail(`${field}.passed`, `期望不大于 rounds（当前 ${rounds}）`)
  }
  // A verdict with no passing round behind it is no verdict: the card would wear 「已验证 ×0」.
  // Normalizing keeps the rest of the snapshot, which is worth more than this one field.
  return { rounds, passed, lastPassed: passed === 0 && lastPassed === true ? null : lastPassed }
}

function readSuperpowersFacts(value: unknown, field: string): SuperpowersFacts {
  const source = readObject(value, field)
  const designSpec = readNullableString(source['designSpec'], `${field}.designSpec`)
  const plan = readNullableString(source['plan'], `${field}.plan`)
  const stage = readEnum(source['stage'], SUPERPOWERS_STAGE_VALUES, `${field}.stage`)
  const planDone = readCount(source['planDone'], `${field}.planDone`)
  const planInProgress = readCount(source['planInProgress'], `${field}.planInProgress`)
  const planTotal = readCount(source['planTotal'], `${field}.planTotal`)
  if (planDone > planTotal) {
    fail(`${field}.planDone`, `期望不大于 planTotal（当前 ${planTotal}）`)
  }
  if (planDone + planInProgress > planTotal) {
    fail(
      `${field}.planInProgress`,
      `期望 planDone + planInProgress 不大于 planTotal（当前 ${planDone} + ${planInProgress} > ${planTotal}）`
    )
  }
  const verification = readNullable(
    source['verification'],
    `${field}.verification`,
    readVerificationFacts
  )
  return { designSpec, plan, stage, planDone, planInProgress, planTotal, verification }
}

function readNextAction(value: unknown, field: string): { label: string; detail: string } {
  const source = readObject(value, field)
  return {
    label: readNonEmptyString(source['label'], `${field}.label`),
    detail: readString(source['detail'], `${field}.detail`)
  }
}

function readProjectOpenspec(value: unknown, field: string): NonNullable<SnapshotProject['openspec']> {
  const source = readObject(value, field)
  return {
    present: readBoolean(source['present'], `${field}.present`),
    capabilities: readStringArray(source['capabilities'], `${field}.capabilities`),
    activeChanges: readCount(source['activeChanges'], `${field}.activeChanges`),
    archived: readCount(source['archived'], `${field}.archived`)
  }
}

function readProjectSuperpowers(
  value: unknown,
  field: string
): NonNullable<SnapshotProject['superpowers']> {
  const source = readObject(value, field)
  return {
    present: readBoolean(source['present'], `${field}.present`),
    specs: readCount(source['specs'], `${field}.specs`),
    plans: readCount(source['plans'], `${field}.plans`)
  }
}

function readOpenspecCli(value: unknown, field: string): NonNullable<SnapshotProject['openspecCli']> {
  const source = readObject(value, field)
  const available = readBoolean(source['available'], `${field}.available`)
  const version = readOptionalString(source['version'], `${field}.version`)
  const path = readOptionalString(source['path'], `${field}.path`)
  return {
    available,
    ...(version === undefined ? {} : { version }),
    ...(path === undefined ? {} : { path })
  }
}

function readProject(value: unknown, field: string): SnapshotProject {
  const source = readObject(value, field)
  const id = readNonEmptyString(source['id'], `${field}.id`)
  const name = readNonEmptyString(source['name'], `${field}.name`)
  const host = readNonEmptyString(source['host'], `${field}.host`)
  const path = readNonEmptyString(source['path'], `${field}.path`)
  const openspec = readNullable(source['openspec'], `${field}.openspec`, readProjectOpenspec)
  const superpowers = readNullable(source['superpowers'], `${field}.superpowers`, readProjectSuperpowers)
  const openspecCli = readNullable(source['openspecCli'], `${field}.openspecCli`, readOpenspecCli)
  const error = readOptionalString(source['error'], `${field}.error`)
  return {
    id,
    name,
    host,
    path,
    openspec,
    superpowers,
    openspecCli,
    scannedAt: readTime(source['scannedAt']),
    ...(error === undefined ? {} : { error })
  }
}

function readItem(value: unknown, field: string): SnapshotItem {
  const source = readObject(value, field)
  const id = readNonEmptyString(source['id'], `${field}.id`)
  const projectId = readNonEmptyString(source['projectId'], `${field}.projectId`)
  const title = readNonEmptyString(source['title'], `${field}.title`)
  const topic = readNonEmptyString(source['topic'], `${field}.topic`)
  const openspec = readNullable(source['openspec'], `${field}.openspec`, readOpenspecFacts)
  const superpowers = readNullable(source['superpowers'], `${field}.superpowers`, readSuperpowersFacts)
  const summary = readOptionalString(source['summary'], `${field}.summary`)
  const nextAction =
    source['nextAction'] === undefined || source['nextAction'] === null
      ? undefined
      : readNextAction(source['nextAction'], `${field}.nextAction`)
  return {
    id,
    projectId,
    title,
    topic,
    openspec,
    superpowers,
    ...(summary === undefined ? {} : { summary }),
    ...(nextAction === undefined ? {} : { nextAction })
  }
}

function readSnapshot(raw: unknown): BoardSnapshot {
  const source = readObject(raw, 'snapshot')
  if (source['schemaVersion'] !== 1) {
    fail('schemaVersion', '期望 1')
  }
  const notes = readOptionalStringArray(source['notes'], 'notes')
  return {
    schemaVersion: 1,
    generatedAt: readTime(source['generatedAt']),
    generatedBy: readGeneratedBy(source['generatedBy'], 'generatedBy'),
    projects: readArray(source['projects'], 'projects').map((entry, index) =>
      readProject(entry, `projects[${index}]`)
    ),
    items: readArray(source['items'], 'items').map((entry, index) =>
      readItem(entry, `items[${index}]`)
    ),
    ...(notes === undefined ? {} : { notes })
  }
}

/**
 * Accepts the JSON the agent wrote as a `BoardSnapshot`, or rejects it with a message that
 * names the offending field. Unknown keys are dropped: the parsed value holds the schema's
 * fields and nothing else.
 */
export function parseBoardSnapshot(raw: unknown): ParseResult {
  try {
    return { ok: true, value: readSnapshot(raw) }
  } catch (error) {
    if (isFailure(error)) {
      return { ok: false, error: error.message }
    }
    // A bug in this validator, not a malformed snapshot: the panel gets a message it can show
    // and the real cause stays in the log, rather than an English fragment in Chinese copy.
    console.error('[spec-board] the snapshot validator failed unexpectedly', error)
    return { ok: false, error: '快照校验器内部错误' }
  }
}
