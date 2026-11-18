import { describe, expect, it } from 'vitest'
import { toWebTerminalSurfaceTabId } from '../../../../shared/workspace-layout/terminal-surface-id'
import { buildRetractedMirroredTabSweepPatch } from './agent-status-primitives'
import { LEAF_ID, makeState } from './testing/web-session-tabs-sync.test-fixture'

const MIRRORED_TAB = toWebTerminalSurfaceTabId('host-tab-1')
const PANE_KEY = `${MIRRORED_TAB}:${LEAF_ID}`

describe('a mirrored tab the host retracts', () => {
  it('drops the composer draft and open flag its panes owned', () => {
    const state = makeState({
      terminalComposerDraftByPaneKey: {
        [PANE_KEY]: {
          document: { type: 'doc', content: [{ type: 'paragraph' }] },
          attachments: []
        }
      },
      terminalComposerOpenByPaneKey: { [PANE_KEY]: true }
    })

    const patch = buildRetractedMirroredTabSweepPatch(
      state,
      state.tabsByWorktree,
      null,
      [MIRRORED_TAB],
      new Map([[MIRRORED_TAB, new Set([PANE_KEY])]])
    )

    expect(patch?.terminalComposerDraftByPaneKey).toEqual({})
    expect(patch?.terminalComposerOpenByPaneKey).toEqual({})
  })
})
