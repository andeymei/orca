import { expect, it } from 'vitest'
import { createTestStore } from '../../testing/app-store-test-fixture'
import type { TerminalComposerDraft } from './terminal-composer'

it('toggles the composer open and closed for one pane', () => {
  const store = createTestStore()
  store.getState().toggleTerminalComposer('tab1:leaf1')
  expect(store.getState().terminalComposerOpenByPaneKey['tab1:leaf1']).toBe(true)
  store.getState().toggleTerminalComposer('tab1:leaf1')
  expect(store.getState().terminalComposerOpenByPaneKey['tab1:leaf1']).toBe(false)
})

it('keeps one pane’s draft out of another pane’s', () => {
  const store = createTestStore()
  store.getState().setTerminalComposerDraft('tab1:leaf1', {
    document: { type: 'doc', content: [{ type: 'paragraph' }] },
    attachments: []
  })
  expect(store.getState().terminalComposerDraftByPaneKey['tab1:leaf2']).toBeUndefined()
})

it('clears a draft without touching the composer’s open state', () => {
  const store = createTestStore()
  store.getState().setTerminalComposerOpen('tab1:leaf1', true)
  store.getState().clearTerminalComposerDraft('tab1:leaf1')
  expect(store.getState().terminalComposerDraftByPaneKey['tab1:leaf1']).toBeUndefined()
  expect(store.getState().terminalComposerOpenByPaneKey['tab1:leaf1']).toBe(true)
})

it('keeps a draft under its own pane key and clears it again', () => {
  const store = createTestStore()
  const draft: TerminalComposerDraft = {
    document: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ship it' }] }]
    },
    attachments: [{ id: 'a1', name: 'shot.png', workspacePath: '/tmp/shot.png', isImage: true }]
  }
  store.getState().setTerminalComposerDraft('tab1:leaf1', draft)
  expect(store.getState().terminalComposerDraftByPaneKey['tab1:leaf1']).toEqual(draft)
  store.getState().clearTerminalComposerDraft('tab1:leaf1')
  expect(store.getState().terminalComposerDraftByPaneKey['tab1:leaf1']).toBeUndefined()
})
