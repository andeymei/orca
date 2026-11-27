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

import { FAILED, PASSED, RECORD_LINE_FORMAT, SEPARATOR } from './verification-records'

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
        // The last counted round failed: an example where the last round passed would not say
        // which round `lastPassed` is about, and the agent imitates this shape.
        verification: { rounds: 2, passed: 1, lastPassed: false }
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
 *
 * The rule says what the parser says: which lines are rounds, which two words are verdicts, and
 * that `lastPassed` is the verdict of the last counted line — the agent that reads "was it ever
 * verified" would write `true` after a failed round, and the card would lie.
 */
export const VERIFICATION_COUNT_RULE = `「## 验证记录」一节里，只有 \`${RECORD_LINE_FORMAT}\` 这样的行才算一轮：日期是真实的 YYYY-MM-DD，结论只认「${PASSED}」或「${FAILED}」两个整词，复选框行（\`- [x] 验证通过\`）不算一轮。
\`rounds\` 是算作轮次的行数，\`passed\` 是其中结论为「${PASSED}」的行数；\`lastPassed\` 是**最后一条算作轮次的行**的结论——最后一轮没通过就是 \`false\`，哪怕前面有通过的。
例：\`- 2026-11-26${SEPARATOR}${PASSED}${SEPARATOR}pnpm tc\` 与 \`- 2026-11-27${SEPARATOR}${FAILED}${SEPARATOR}pnpm lint\` 两行 → \`{"rounds": 2, "passed": 1, "lastPassed": false}\`。`

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
