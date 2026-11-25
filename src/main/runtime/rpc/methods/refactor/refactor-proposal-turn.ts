import { homedir } from 'node:os'
import path from 'node:path'

import type { OrcaRuntimeService } from '../../../orca-runtime'
import { buildRefactorPlan } from '../../../../refactor/refactor-plan-builder'
import { salvageRefactorPlan } from '../../../../refactor/refactor-plan-salvage'
import { refactorJobRegistry, type RefactorJob } from '../../../../refactor/refactor-job-registry'
import { refactorBaselineReader } from '../../../../refactor/refactor-baselines'
import {
  listScratchProposals,
  readScratchFile,
  readWorkspaceFile
} from '../../../../refactor/refactor-file-reads'
import { REFACTOR_SOURCE_DIRECTORY_NAME } from '../../../../refactor/refactor-scratch'
import { readRefactorProviderEnv } from '../../../../refactor/refactor-provider-env'
import { resolveRefactorAgentLaunch } from '../../../../refactor/refactor-agent-launch'
import { runRefactorTurn } from '../../../../refactor/refactor-runner'
import { buildRefactorPrompt } from '../../../../../shared/refactor/refactor-prompt'
import { claudeStructuredAuthPolicyForSettings } from '../../../../claude-accounts/runtime-auth/claude-structured-auth-policy'
import { resolveStructuredAgentCommand } from '../../../../native-chat/agent-launch/structured-agent-command-resolution'
import { resolveTuiAgentLaunchEnv } from '../../../../../shared/agent-launch/choices/tui-agent-launch-defaults'

/**
 * The agent turn of a refactoring, and the plan it leaves for the review.
 *
 * Why it is its own module: the propose handler answers the caller right away, and everything
 * after that — the launch, the turn, the plan — belongs to the job rather than to the request.
 */
export async function runRefactorProposalTurn(input: {
  runtime: OrcaRuntimeService
  job: RefactorJob
  /** The scratch root as the agent was told it. */
  scratchRelativeRoot: string
  workspaceRoot: string
  relativePath: string
  instruction?: string
}): Promise<void> {
  const { runtime, job, workspaceRoot, relativePath } = input
  const jobId = job.jobId
  const scratchRoot = job.scratchRoot
  const signal = job.controller.signal
  const settings = runtime.requireStore().getSettings()
  // The account is pushed and Claude refreshed before the agent starts, so the launch
  // uses the account the user picked instead of a stale one.
  await runtime.prepareHostAgentLaunch('claude')
  const hostEnv = runtime.getHostAgentLaunchEnv('claude')
  const launch = await resolveRefactorAgentLaunch({
    cwd: workspaceRoot,
    deps: {
      // The same resolution path as the native chat: a configured Command wins, and the
      // agent name is resolved otherwise.
      resolveCommand: (options) => resolveStructuredAgentCommand('claude', settings, options),
      // Only labels the sign-in failure; it does not pick the executable.
      resolveAuthPolicy: () => claudeStructuredAuthPolicyForSettings(settings),
      // The user's own per-agent environment, the environment of the current account, and
      // the provider connection the host's Claude settings carry.
      resolveEnv: async () => ({
        ...(await readRefactorProviderEnv(
          hostEnv.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude')
        )),
        ...resolveTuiAgentLaunchEnv('claude', settings),
        ...hostEnv
      })
    },
    signal
  })
  const turn = await runRefactorTurn({
    launch,
    scratchRoot,
    workspaceRoot,
    prompt: buildRefactorPrompt({
      relativePath,
      sourceRelativePath: path.join(
        input.scratchRelativeRoot,
        REFACTOR_SOURCE_DIRECTORY_NAME,
        relativePath
      ),
      scratchRelativeRoot: input.scratchRelativeRoot,
      instruction: input.instruction
    }),
    onProgress: (text) => {
      refactorJobRegistry.update(jobId, { progress: text })
    },
    signal
  })
  if (signal.aborted) {
    return
  }
  const planInput = {
    jobId,
    sourcePath: relativePath,
    scratchRoot,
    workspaceRoot,
    // The target file's baseline is the buffer the user saw; every other file's baseline
    // is the disk content of the moment.
    readBaseline: refactorBaselineReader({
      baselines: job.baselines,
      workspaceRoot
    }),
    readDiskContent: async (filePath: string) => {
      const read = await readWorkspaceFile(workspaceRoot, filePath)
      return read.status === 'read' ? read.content : null
    },
    scratchFiles: (proposalId: string, filePath: string) =>
      readScratchFile(scratchRoot, proposalId, filePath),
    listScratchProposals: () => listScratchProposals(scratchRoot),
    signal
  }
  if (turn.state !== 'done') {
    // Why the salvage: the agent writes its proposals before its index, so a turn that was
    // cut off has the changes on disk and no manifest. The work is worth more than the
    // reason the turn stopped.
    const salvaged = await salvageRefactorPlan({
      plan: planInput,
      completedWriteKeys: turn.completedWriteKeys
    })
    const kept = salvaged.plan.proposals.length > 0
    refactorJobRegistry.update(jobId, {
      state: turn.state,
      progress: turn.progress,
      warnings: [...turn.warnings, ...salvaged.warnings],
      plan: kept ? salvaged.plan : null,
      diskContents: salvaged.diskContents
    })
    return
  }
  const built = await buildRefactorPlan({ ...planInput, manifest: turn.manifest })
  refactorJobRegistry.update(jobId, {
    state: 'done',
    progress: turn.progress,
    warnings: [...turn.warnings, ...built.warnings],
    plan: built.plan,
    diskContents: built.diskContents
  })
}
