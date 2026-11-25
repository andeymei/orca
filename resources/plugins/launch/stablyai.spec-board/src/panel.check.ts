// `orca plugin check` renders the panel once per scenario, each with the worker on a fresh
// host. Seed what the host answers `board.get` with, so check shows more than the first state.
import { defineCheck } from 'orca/testing'
import { fixturePayload } from './panel-fixture'

/** The tab the check opens on; the panel keeps the tab it was left on. */
const PROJECTS_TAB = { plugin: { 'spec-board.tab': 'projects' } }

export default defineCheck({
  empty: {
    requests: {
      'board.get': () => ({
        items: [],
        projects: [],
        sources: { localAt: null, agentAt: null },
        warnings: []
      })
    }
  },
  loaded: { requests: { 'board.get': () => fixturePayload } },
  broken: {
    requests: {
      'board.get': () => ({
        items: [],
        projects: [],
        sources: { localAt: null, agentAt: null },
        warnings: ['board.json: schemaVersion: 期望 1']
      })
    }
  },
  projects: {
    persisted: PROJECTS_TAB,
    requests: { 'board.get': () => fixturePayload }
  },
  projectsLight: {
    persisted: PROJECTS_TAB,
    theme: 'light',
    requests: { 'board.get': () => fixturePayload }
  }
})
