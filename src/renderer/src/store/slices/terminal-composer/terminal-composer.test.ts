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

it('drops one pane’s draft and open flag together', () => {
  const store = createTestStore()
  store.getState().setTerminalComposerOpen('tab1:leaf1', true)
  store.getState().setTerminalComposerDraft('tab1:leaf1', {
    document: { type: 'doc', content: [{ type: 'paragraph' }] },
    attachments: []
  })
  store.getState().setTerminalComposerOpen('tab1:leaf2', true)
  store.getState().clearTerminalComposerPane('tab1:leaf1')
  expect(store.getState().terminalComposerDraftByPaneKey['tab1:leaf1']).toBeUndefined()
  expect(store.getState().terminalComposerOpenByPaneKey['tab1:leaf1']).toBeUndefined()
  expect(store.getState().terminalComposerOpenByPaneKey['tab1:leaf2']).toBe(true)
})

it('drops every draft and open flag a closed tab owned', () => {
  const store = createTestStore()
  const leafA = '11111111-1111-4111-8111-111111111111'
  const leafB = '22222222-2222-4222-8222-222222222222'
  const otherLeaf = '33333333-3333-4333-8333-333333333333'
  store.getState().setTerminalComposerOpen(`tab1:${leafA}`, true)
  store.getState().setTerminalComposerOpen(`tab1:${leafB}`, true)
  store.getState().setTerminalComposerDraft(`tab1:${leafA}`, {
    document: { type: 'doc', content: [{ type: 'paragraph' }] },
    attachments: []
  })
  store.getState().setTerminalComposerOpen(`tab2:${otherLeaf}`, true)
  store.getState().clearTerminalComposerStateForTab('tab1')
  expect(store.getState().terminalComposerDraftByPaneKey[`tab1:${leafA}`]).toBeUndefined()
  expect(store.getState().terminalComposerOpenByPaneKey[`tab1:${leafA}`]).toBeUndefined()
  expect(store.getState().terminalComposerOpenByPaneKey[`tab1:${leafB}`]).toBeUndefined()
  expect(store.getState().terminalComposerOpenByPaneKey[`tab2:${otherLeaf}`]).toBe(true)
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
