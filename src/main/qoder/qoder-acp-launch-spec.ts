import { join } from 'node:path'
import type { AcpLaunchSpec } from '../acp/launch/acp-launch-contract'
import { GENERIC_ACP_DIALECT } from '../acp/acp-dialects/acp-dialect'
import { directoryAccountBinding } from '../acp/launch/acp-account-binding'
import { agentSessionSetupFor } from '../../shared/agent-session/lifecycle/agent-session-setup-commands'
import {
  resumeInvocationFromOptions,
  sessionFileResumeTargetMatches,
  type StructuredAgentSessionHistory
} from '../native-chat/structured-agent-cli-conversations'

type QoderBuild = {
  agent: 'qoder' | 'qoder-cn'
  command: string
  accountHomeVariable: string
  accountDirName: '.qoder' | '.qoder-cn'
  installDir: (homePath: string) => string
}

const QODER_BUILDS: readonly QoderBuild[] = [
  {
    agent: 'qoder',
    command: 'qodercli',
    accountHomeVariable: 'QODER_CONFIG_DIR',
    accountDirName: '.qoder',
    installDir: (homePath) => join(homePath, '.qoder', 'bin', 'qodercli')
  },
  {
    agent: 'qoder-cn',
    command: 'qoderclicn',
    accountHomeVariable: 'QODERCN_CONFIG_DIR',
    accountDirName: '.qoder-cn',
    installDir: (homePath) => join(homePath, '.qoder-cn', 'bin')
  }
]

function qoderSessionHistory(agent: 'qoder' | 'qoder-cn'): StructuredAgentSessionHistory {
  return {
    rowAgents: [agent],
    rowSessionId: (link) => link.handle.nativeId,
    // Qoder stores sessions under its projects folder, whose files are Claude-shaped.
    // The CLI documents `-r/--resume [id]` and `-c/--continue`, so every documented spelling
    // must reach the resume guard.
    parseResumeArgs: (args) =>
      resumeInvocationFromOptions(args, {
        targetless: ['-c', '--continue'],
        markers: ['-r', '--resume']
      }),
    resumeTargetMatches: sessionFileResumeTargetMatches
  }
}

function qoderAcpLaunchSpec(build: QoderBuild): AcpLaunchSpec {
  return {
    agent: build.agent,
    command: build.command,
    // No bypass flag; full access approves permission requests individually.
    args: () => ['--acp'],
    env: {},
    // An inherited permission mode would bypass the prompts while the chat shows Ask.
    scrubEnvironment: (env) => {
      delete env.QODER_PERMISSION_MODE
      delete env.QODERCN_PERMISSION_MODE
      return ['QODER_PERMISSION_MODE', 'QODERCN_PERMISSION_MODE']
    },
    dialect: GENERIC_ACP_DIALECT,
    loginCommand: agentSessionSetupFor(build.agent)?.loginCommand ?? [],
    account: directoryAccountBinding(build.accountHomeVariable, (homePath) =>
      join(homePath, build.accountDirName)
    ),
    installDirectories: ({ homePath }) => [build.installDir(homePath)],
    // The CLI has --list-models, but its output format is not documented, so there is
    // nothing stable to parse.
    modelDiscovery: {
      kind: 'unavailable',
      reason: 'Qoder CLI has --list-models, but its output format is not documented'
    },
    compaction: true,
    // /compact takes focus areas after the command.
    compactionInstructions: true,
    transcriptImport: null,
    sessionHistory: qoderSessionHistory(build.agent)
  }
}

export const QODER_ACP_LAUNCH_SPECS: readonly AcpLaunchSpec[] = QODER_BUILDS.map(qoderAcpLaunchSpec)
