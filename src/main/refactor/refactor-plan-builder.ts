import { computeRefactorHunks } from '../../shared/refactor/refactor-hunk-computation'
import {
  REFACTOR_MAX_FILES_PER_PROPOSAL,
  REFACTOR_MAX_PROPOSALS
} from '../../shared/refactor/refactor-limits'
import type { RefactorManifest } from '../../shared/refactor/refactor-manifest'
import type {
  RefactorFileProposal,
  RefactorPlan,
  RefactorProposal
} from '../../shared/refactor/refactor-types'
import { isSafeRelativeRefactorPath, refactorPathKey } from './refactor-path-rules'
import { REFACTOR_SOURCE_DIRECTORY_NAME } from './refactor-scratch'

const SOURCE_IGNORED_WARNING = `方案 ${REFACTOR_SOURCE_DIRECTORY_NAME} 是基准副本，已忽略`

export type RefactorPlanInput = {
  jobId: string
  sourcePath: string
  manifest: RefactorManifest | null
  /** The roots belong to the caller: the injected reads resolve their paths against them. */
  scratchRoot: string
  workspaceRoot: string
  readBaseline: (relativePath: string) => Promise<string | null>
  readDiskContent: (relativePath: string) => Promise<string | null>
  /** Reads `<scratchRoot>/<proposalId>/<relativePath>`. */
  scratchFiles: (proposalId: string, relativePath: string) => Promise<string | null>
  /**
   * The proposal directories under the scratch root, each with the files it holds. A file path is
   * relative to its proposal directory, so it is the workspace-relative path the plan uses:
   * `<scratchRoot>/p1/src/foo.ts` is reported as `src/foo.ts`.
   */
  listScratchProposals: () => Promise<{ id: string; files: string[] }[]>
  /** Stops the build when the job is discarded; a build in flight otherwise only wastes its reads. */
  signal?: AbortSignal
}

export type RefactorPlanResult = {
  plan: RefactorPlan
  warnings: string[]
  diskContents: Map<string, string>
}

type ProposalDraft = {
  id: string
  title: string
  rationale: string
  files: string[]
  /** True when the manifest was missing and the draft was rebuilt from the scratch tree. */
  restored: boolean
  /** True when the manifest named the proposal but not the files it changes. */
  filesFromTree: boolean
}

type ProposalOutcome =
  | { kept: true; proposal: RefactorProposal; diskContents: Map<string, string> }
  | { kept: false; warning: string }

async function draftsFromScratchTree(
  input: RefactorPlanInput,
  warnings: string[]
): Promise<ProposalDraft[]> {
  const entries = await input.listScratchProposals()
  const drafts: ProposalDraft[] = []
  for (const entry of entries) {
    if (entry.id === REFACTOR_SOURCE_DIRECTORY_NAME) {
      warnings.push(SOURCE_IGNORED_WARNING)
      continue
    }
    drafts.push({
      id: entry.id,
      title: entry.id,
      rationale: '',
      files: entry.files,
      restored: true,
      filesFromTree: false
    })
  }
  return drafts
}

/**
 * The drafts of a manifest that names its proposals.
 *
 * Why the tree is read: the manifest is an index, and an index that leaves out a page is still an
 * index — the tree knows which files the proposal wrote.
 */
async function draftsFromManifest(
  manifest: RefactorManifest,
  input: RefactorPlanInput,
  warnings: string[]
): Promise<ProposalDraft[]> {
  const treeFiles = await scratchFilesByProposal(input, manifest)
  const drafts: ProposalDraft[] = []
  for (const proposal of manifest.proposals) {
    if (proposal.id === REFACTOR_SOURCE_DIRECTORY_NAME) {
      warnings.push(SOURCE_IGNORED_WARNING)
      continue
    }
    const files = proposal.files
    if (files === undefined) {
      drafts.push({
        id: proposal.id,
        title: proposal.title,
        rationale: proposal.rationale,
        files: treeFiles.get(proposal.id) ?? [],
        restored: false,
        filesFromTree: true
      })
      continue
    }
    drafts.push({
      id: proposal.id,
      title: proposal.title,
      rationale: proposal.rationale,
      files,
      restored: false,
      filesFromTree: false
    })
  }
  return drafts
}

/**
 * The file list of every proposal directory in the scratch tree.
 *
 * Why it is read only when the manifest needs it: the tree is the fallback for a manifest that
 * names no files, and walking it costs a directory read.
 */
async function scratchFilesByProposal(
  input: RefactorPlanInput,
  manifest: RefactorManifest
): Promise<Map<string, string[]>> {
  const needsTree = manifest.proposals.some((proposal) => proposal.files === undefined)
  if (!needsTree) {
    return new Map()
  }
  const entries = await input.listScratchProposals()
  return new Map(entries.map((entry) => [entry.id, entry.files]))
}

async function evaluateProposal(
  draft: ProposalDraft,
  input: RefactorPlanInput,
  claimedPaths: Map<string, string>,
  claimedIds: Set<string>
): Promise<ProposalOutcome> {
  // The proposal id becomes a directory in the scratch path, so it has to be a safe relative path
  // like the file paths are.
  if (!isSafeRelativeRefactorPath(draft.id)) {
    return { kept: false, warning: `方案 ${draft.id} 的编号不是安全的相对路径，已丢弃` }
  }
  // Two proposals under one id cannot be told apart in the review UI.
  if (claimedIds.has(draft.id)) {
    return { kept: false, warning: `方案 ${draft.id} 的编号重复，已丢弃` }
  }
  // The agent may write more files than the limit allows; the plan does not grow past it.
  if (draft.files.length > REFACTOR_MAX_FILES_PER_PROPOSAL) {
    return {
      kept: false,
      warning: `方案 ${draft.id} 的文件数超出上限（最多 ${REFACTOR_MAX_FILES_PER_PROPOSAL} 个），已丢弃`
    }
  }
  // Every read-free check runs before anything is read: a proposal that gets dropped must not
  // leave its disk content behind for the staleness check to compare against.
  const paths: string[] = []
  const pathKeys = new Set<string>()
  for (const filePath of draft.files) {
    if (!isSafeRelativeRefactorPath(filePath)) {
      return {
        kept: false,
        warning: `方案 ${draft.id} 的文件路径不在工作区内，已丢弃：${filePath}`
      }
    }
    // The key folds the separator spelling and the case: macOS and Windows treat `src/Foo.ts` and
    // `src\foo.ts` as one file, and a missed conflict silently overwrites the first proposal's file.
    const pathKey = refactorPathKey(filePath)
    const owner = claimedPaths.get(pathKey)
    if (owner !== undefined) {
      return {
        kept: false,
        warning: `方案 ${draft.id} 与方案 ${owner} 改同一个文件，已丢弃后者：${filePath}`
      }
    }
    if (pathKeys.has(pathKey)) {
      return { kept: false, warning: `方案 ${draft.id} 重复列出了同一个文件，已丢弃：${filePath}` }
    }
    pathKeys.add(pathKey)
    paths.push(filePath)
  }
  if (paths.length === 0) {
    return { kept: false, warning: `方案 ${draft.id} 没有文件，已丢弃` }
  }

  const files: RefactorFileProposal[] = []
  const diskContents = new Map<string, string>()
  for (const filePath of paths) {
    if (input.signal?.aborted === true) {
      return { kept: false, warning: `方案 ${draft.id} 的重构任务已取消，已丢弃` }
    }
    const modified = await input.scratchFiles(draft.id, filePath)
    if (modified === null) {
      return { kept: false, warning: `方案 ${draft.id} 的暂存文件读不到，已丢弃：${filePath}` }
    }
    const baseline = await input.readBaseline(filePath)
    if (baseline === null) {
      return { kept: false, warning: `方案 ${draft.id} 的基准内容读不到，已丢弃：${filePath}` }
    }
    const disk = await input.readDiskContent(filePath)
    if (disk === null) {
      return { kept: false, warning: `方案 ${draft.id} 的磁盘内容读不到，已丢弃：${filePath}` }
    }
    files.push({
      path: filePath,
      originalContent: baseline,
      // The hunk id names the file: the accepted set is flat, so `h1` in two files would be
      // accepted together.
      hunks: computeRefactorHunks(baseline, modified, `${filePath}:`)
    })
    diskContents.set(filePath, disk)
  }

  return {
    kept: true,
    proposal: { id: draft.id, title: draft.title, rationale: draft.rationale, files },
    diskContents
  }
}

/**
 * The plan is the app's own diff: the model never produces line numbers, so the hunks come from
 * the repo's diff package applied to the baseline the user sees.
 */
export async function buildRefactorPlan(input: RefactorPlanInput): Promise<RefactorPlanResult> {
  const warnings: string[] = []
  const drafts =
    input.manifest === null
      ? await draftsFromScratchTree(input, warnings)
      : await draftsFromManifest(input.manifest, input, warnings)

  // The limit holds on both paths: the manifest names its proposals, and the tree names its
  // directories — neither may grow the plan past what the review tab can show.
  const withinLimit = drafts.slice(0, REFACTOR_MAX_PROPOSALS)
  for (const dropped of drafts.slice(REFACTOR_MAX_PROPOSALS)) {
    warnings.push(
      `方案 ${dropped.id} 超出方案数量上限（最多 ${REFACTOR_MAX_PROPOSALS} 个），已丢弃`
    )
  }

  const proposals: RefactorProposal[] = []
  const diskContents = new Map<string, string>()
  const claimedPaths = new Map<string, string>()
  const claimedIds = new Set<string>()

  for (const draft of withinLimit) {
    if (input.signal?.aborted === true) {
      warnings.push('重构任务已取消')
      break
    }
    const outcome = await evaluateProposal(draft, input, claimedPaths, claimedIds)
    if (!outcome.kept) {
      warnings.push(outcome.warning)
      continue
    }
    proposals.push(outcome.proposal)
    claimedIds.add(draft.id)
    for (const [filePath, disk] of outcome.diskContents) {
      claimedPaths.set(refactorPathKey(filePath), draft.id)
      diskContents.set(filePath, disk)
    }
    if (draft.restored) {
      warnings.push(`方案 ${draft.id} 是从暂存目录还原的，agent 未给出理由`)
    }
    if (draft.filesFromTree) {
      warnings.push(`方案 ${draft.id} 在清单里没有列出文件，已按暂存目录还原`)
    }
  }

  return {
    plan: { jobId: input.jobId, sourcePath: input.sourcePath, proposals },
    warnings,
    diskContents
  }
}
