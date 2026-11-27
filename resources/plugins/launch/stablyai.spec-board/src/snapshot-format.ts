// The snapshot the agent writes, as an example.
//
// It is shown in the file the agent reads, not in the prompt: the prompt has room for the task and
// the rules, and the schema as well would not fit — `agent.launch` refuses a prompt over 4096
// characters, and a refresh that cannot start collects nothing.
//
// The example is a real snapshot: `snapshot-format.test.ts` runs it through the validator, so the
// shape the agent is shown is a shape the board accepts.
//
// The rules for filling that shape travel with it, in the same field: the prompt names
// `snapshotFormat` and nothing else, so a rule in a field it does not name is a rule nobody
// reads.

export const SNAPSHOT_FORMAT = {
  schemaVersion: 1,
  generatedAt: '2026-11-25T10:00:00.000Z',
  generatedBy: { agent: 'claude' },
  projects: [
    {
      id: 'local|/Users/me/repo',
      name: 'repo',
      host: 'local',
      path: '/Users/me/repo',
      openspec: { present: true, capabilities: ['core'], activeChanges: 1, archived: 0 },
      superpowers: { present: true, specs: 1, plans: 1 },
      openspecCli: { available: true, version: '1.8.0' },
      scannedAt: '2026-11-25T10:00:00.000Z'
    }
  ],
  items: [
    {
      id: 'local|/Users/me/repo#add-x',
      projectId: 'local|/Users/me/repo',
      title: '新增 X',
      topic: 'add-x',
      openspec: {
        changeId: 'add-x',
        stage: 'implementing',
        hasProposal: true,
        hasDesign: true,
        hasTasks: true,
        tasksDone: 1,
        tasksInProgress: 0,
        tasksTotal: 4,
        capabilities: []
      },
      superpowers: {
        designSpec: 'docs/superpowers/specs/add-x-design.md',
        plan: 'docs/superpowers/plans/add-x.md',
        stage: 'executing',
        planDone: 1,
        planInProgress: 0,
        planTotal: 4,
        verification: { rounds: 2, passed: 1, lastPassed: true }
      }
    }
  ]
}

/**
 * The rule that tells the agent to count the verification rounds and write the count into the
 * snapshot.
 *
 * It travels in the list file, not in the prompt: the prompt is within a few dozen characters of
 * the limit on a real path, and a rule that does not fit stops the refresh from starting at all —
 * silently, and with the local scan path saying nothing.
 */
export const VERIFICATION_COUNT_RULE = '「## 验证记录」轮次写进 `superpowers.verification`'

/**
 * What the agent is shown about the snapshot: its shape, and the rules for filling it.
 *
 * The `rules` key sits beside the shape's own fields, so an agent that copies the whole thing
 * into its snapshot writes a key the board does not know — and the board drops it.
 */
export const AGENT_SNAPSHOT_FORMAT = {
  ...SNAPSHOT_FORMAT,
  rules: {
    verification: VERIFICATION_COUNT_RULE
  }
}
