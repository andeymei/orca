import { computeRefactorHunks } from '../../shared/refactor/refactor-hunk-computation'
import type { RefactorManifest } from '../../shared/refactor/refactor-manifest'
import type {
  RefactorFileProposal,
  RefactorPlan,
  RefactorProposal
} from '../../shared/refactor/refactor-types'
import { isSafeMobileRelativePath } from '../runtime/files/mobile-file-kind'
import { hasUnsafePathSegment } from './refactor-write-gate'

/** The baseline copy written when the job started: it is the source, not a proposal. */
const SOURCE_DIRECTORY_NAME = '_source'

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
}

type ProposalOutcome =
  | { kept: true; proposal: RefactorProposal; diskContents: Map<string, string> }
  | { kept: false; warning: string }

/**
 * The mobile guard rejects absolute paths and `..` segments; the write gate's guard adds the
 * trailing dot and space Windows strips before it reads `.` and `..`.
 */
export function isSafeRelativeRefactorPath(relativePath: string): boolean {
  return isSafeMobileRelativePath(relativePath) && !hasUnsafePathSegment(relativePath)
}

async function draftsFromScratchTree(
  input: RefactorPlanInput,
  warnings: string[]
): Promise<ProposalDraft[]> {
  const entries = await input.listScratchProposals()
  const drafts: ProposalDraft[] = []
  for (const entry of entries) {
    if (entry.id === SOURCE_DIRECTORY_NAME) {
      warnings.push(`方案 ${SOURCE_DIRECTORY_NAME} 是基准副本，已忽略`)
      continue
    }
    drafts.push({
      id: entry.id,
      title: entry.id,
      rationale: '',
      files: entry.files,
      restored: true
    })
  }
  return drafts
}

function draftsFromManifest(manifest: RefactorManifest, warnings: string[]): ProposalDraft[] {
  const drafts: ProposalDraft[] = []
  for (const proposal of manifest.proposals) {
    if (proposal.id === SOURCE_DIRECTORY_NAME) {
      warnings.push(`方案 ${SOURCE_DIRECTORY_NAME} 是基准副本，已忽略`)
      continue
    }
    drafts.push({
      id: proposal.id,
      title: proposal.title,
      rationale: proposal.rationale,
      files: proposal.files,
      restored: false
    })
  }
  return drafts
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
    // The key is lower-cased: macOS and Windows treat `src/Foo.ts` and `src/foo.ts` as one file,
    // and a missed conflict silently overwrites the first proposal's file.
    const pathKey = filePath.toLowerCase()
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
      : draftsFromManifest(input.manifest, warnings)

  const proposals: RefactorProposal[] = []
  const diskContents = new Map<string, string>()
  const claimedPaths = new Map<string, string>()
  const claimedIds = new Set<string>()

  for (const draft of drafts) {
    const outcome = await evaluateProposal(draft, input, claimedPaths, claimedIds)
    if (!outcome.kept) {
      warnings.push(outcome.warning)
      continue
    }
    proposals.push(outcome.proposal)
    claimedIds.add(draft.id)
    for (const [filePath, disk] of outcome.diskContents) {
      claimedPaths.set(filePath.toLowerCase(), draft.id)
      diskContents.set(filePath, disk)
    }
    if (draft.restored) {
      warnings.push(`方案 ${draft.id} 是从暂存目录还原的，agent 未给出理由`)
    }
  }

  return {
    plan: { jobId: input.jobId, sourcePath: input.sourcePath, proposals },
    warnings,
    diskContents
  }
}
