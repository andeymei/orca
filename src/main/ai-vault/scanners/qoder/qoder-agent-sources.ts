import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AiVaultAgentSource } from '../../discovery/session-scanner-agent-sources'
import { sessionRootDirs } from '../../discovery/session-scanner-roots'
import type { AiVaultScanOptions } from '../../session-scanner-types'
import { SUBAGENT_DIR_NAME } from '../claude/session-scanner-subagent-transcripts'

/** The two Qoder builds share a layout; only the config home differs. */
function qoderAgentSource(
  homeDirName: '.qoder' | '.qoder-cn',
  projectsDirOf: (options: AiVaultScanOptions) => string | undefined
): AiVaultAgentSource {
  return {
    rootDirs: (options, wslHomeDirs) =>
      sessionRootDirs(
        projectsDirOf(options) ?? join(homedir(), homeDirName, 'projects'),
        wslHomeDirs,
        [homeDirName, 'projects']
      ),
    extensions: ['.jsonl'],
    directoryPredicate: (name) => name !== SUBAGENT_DIR_NAME
  }
}

export const QODER_AGENT_SOURCE = qoderAgentSource('.qoder', (options) => options.qoderProjectsDir)

export const QODER_CN_AGENT_SOURCE = qoderAgentSource(
  '.qoder-cn',
  (options) => options.qoderCnProjectsDir
)
