// `orca plugin check` renders the panel once per scenario, each with the worker on a fresh
// host. Seed what the host answers `board.get` with, so check shows more than the first state.
import { defineCheck } from 'orca/testing'
import { fixturePayload } from './panel-fixture'

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
  }
})
