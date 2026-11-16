import { describe, expect, it } from 'vitest'
import {
  buildBackgroundAgentListRows,
  countBackgroundAgentListRows,
  filterBackgroundAgentListRows,
  formatBackgroundAgentElapsed,
  groupBackgroundAgentListRows
} from './background-agent-list-rows'

describe('buildBackgroundAgentListRows', () => {
  it('sorts the sections the way the CLI lists them, the working agents first', () => {
    const rows = buildBackgroundAgentListRows(
      [
        { id: 'cccc3333', sessionId: 's', name: 'done', cwd: '/w', state: 'done' },
        {
          id: 'bbbb2222',
          sessionId: 's',
          name: 'busy',
          cwd: '/w',
          state: 'working',
          status: 'busy'
        },
        {
          id: 'aaaa1111',
          sessionId: 's',
          name: 'waiting',
          cwd: '/w',
          state: 'blocked',
          status: 'waiting'
        }
      ],
      {
        aaaa1111: { detail: 'answer: 选 A 还是 B？', needs: 'answer: 选 A 还是 B？', updatedAt: 5 }
      }
    )
    expect(rows.map((row) => row.section)).toEqual(['working', 'needs-input', 'completed'])
    expect(rows.map((row) => row.id)).toEqual(['bbbb2222', 'aaaa1111', 'cccc3333'])
  })

  it('leaves out a session that is not a background agent', () => {
    const rows = buildBackgroundAgentListRows(
      [
        { id: 'aaaa1111', sessionId: 's', name: 'bg', cwd: '/w', kind: 'background' },
        { id: 'bbbb2222', sessionId: 's', name: 'fg', cwd: '/w', kind: 'interactive' }
      ],
      {}
    )
    expect(rows.map((row) => row.id)).toEqual(['aaaa1111'])
  })

  it('takes the agent name from the listing, not from the detail file', () => {
    // The agent renames itself while it works; the row title must follow the listing.
    const rows = buildBackgroundAgentListRows(
      [{ id: 'aaaa1111', sessionId: 's', name: 'bash sleep command', cwd: '/w', state: 'working' }],
      { aaaa1111: { detail: 'Waiting 20 seconds', needs: null, updatedAt: 5 } }
    )
    expect(rows[0].name).toBe('bash sleep command')
    expect(rows[0].detail).toBe('Waiting 20 seconds')
  })

  it('keeps a row whose activity file cannot be read', () => {
    const rows = buildBackgroundAgentListRows(
      [{ id: 'aaaa1111', sessionId: 's', name: 'bg', cwd: '/w', state: 'working' }],
      {}
    )
    expect(rows[0].detail).toBeNull()
  })

  it('treats a missing state as finished rather than as working', () => {
    const rows = buildBackgroundAgentListRows(
      [{ id: 'aaaa1111', sessionId: 's', name: 'bg', cwd: '/w' }],
      {}
    )
    expect(rows[0].section).toBe('completed')
  })

  it('shows the newest agent of a section first', () => {
    const rows = buildBackgroundAgentListRows(
      [
        { id: 'old', sessionId: 's', name: 'old', cwd: '/w', state: 'working', startedAt: 10 },
        { id: 'new', sessionId: 's', name: 'new', cwd: '/w', state: 'working', startedAt: 20 }
      ],
      {}
    )
    expect(rows.map((row) => row.id)).toEqual(['new', 'old'])
  })
})

describe('groupBackgroundAgentListRows', () => {
  it('keeps each section in its own list', () => {
    const groups = groupBackgroundAgentListRows([
      {
        id: 'a',
        name: 'a',
        cwd: '/w',
        section: 'working',
        state: 'working',
        detail: null,
        needs: null,
        startedAt: 0,
        updatedAt: null
      },
      {
        id: 'b',
        name: 'b',
        cwd: '/w',
        section: 'needs-input',
        state: 'blocked',
        detail: null,
        needs: null,
        startedAt: 0,
        updatedAt: null
      },
      {
        id: 'c',
        name: 'c',
        cwd: '/w',
        section: 'completed',
        state: 'done',
        detail: null,
        needs: null,
        startedAt: 0,
        updatedAt: null
      }
    ])
    expect(groups.working.map((r) => r.id)).toEqual(['a'])
    expect(groups.needsInput.map((r) => r.id)).toEqual(['b'])
    expect(groups.completed.map((r) => r.id)).toEqual(['c'])
  })
})

describe('countBackgroundAgentListRows', () => {
  it('counts every section on its own', () => {
    const rows = [
      {
        id: 'a',
        name: 'a',
        cwd: '/w',
        section: 'working' as const,
        state: 'working' as const,
        detail: null,
        needs: null,
        startedAt: 0,
        updatedAt: null
      },
      {
        id: 'b',
        name: 'b',
        cwd: '/w',
        section: 'working' as const,
        state: 'working' as const,
        detail: null,
        needs: null,
        startedAt: 0,
        updatedAt: null
      },
      {
        id: 'c',
        name: 'c',
        cwd: '/w',
        section: 'needs-input' as const,
        state: 'blocked' as const,
        detail: null,
        needs: null,
        startedAt: 0,
        updatedAt: null
      },
      {
        id: 'd',
        name: 'd',
        cwd: '/w',
        section: 'completed' as const,
        state: 'done' as const,
        detail: null,
        needs: null,
        startedAt: 0,
        updatedAt: null
      }
    ]
    expect(countBackgroundAgentListRows(rows)).toEqual({
      awaitingInput: 1,
      working: 2,
      completed: 1
    })
  })
})

describe('filterBackgroundAgentListRows', () => {
  const rows = [
    {
      id: 'a',
      name: 'fix the parser',
      cwd: '/repos/app',
      section: 'working' as const,
      state: 'working' as const,
      detail: 'reading the file',
      needs: null,
      startedAt: 0,
      updatedAt: null
    },
    {
      id: 'b',
      name: 'other work',
      cwd: '/repos/other',
      section: 'working' as const,
      state: 'working' as const,
      detail: null,
      needs: null,
      startedAt: 0,
      updatedAt: null
    }
  ]
  it('matches the name, the activity line and the directory', () => {
    expect(filterBackgroundAgentListRows(rows, 'parser').map((r) => r.id)).toEqual(['a'])
    expect(filterBackgroundAgentListRows(rows, 'reading').map((r) => r.id)).toEqual(['a'])
    expect(filterBackgroundAgentListRows(rows, 'other').map((r) => r.id)).toEqual(['b'])
  })
  it('keeps everything for an empty query', () => {
    expect(filterBackgroundAgentListRows(rows, '  ')).toHaveLength(2)
  })
  it('matches the name whatever its case', () => {
    expect(filterBackgroundAgentListRows(rows, 'PARSER').map((r) => r.id)).toEqual(['a'])
  })
})

describe('formatBackgroundAgentElapsed', () => {
  it('reads like the list the CLI draws', () => {
    expect(formatBackgroundAgentElapsed(10_000)).toBe('10s')
    expect(formatBackgroundAgentElapsed(4 * 60_000)).toBe('4m')
    expect(formatBackgroundAgentElapsed(47 * 60_000)).toBe('47m')
    expect(formatBackgroundAgentElapsed(60 * 60_000)).toBe('1h')
    expect(formatBackgroundAgentElapsed(17 * 60 * 60_000)).toBe('17h')
  })

  it('counts days, and never a negative time', () => {
    expect(formatBackgroundAgentElapsed(50 * 60 * 60_000)).toBe('2d')
    expect(formatBackgroundAgentElapsed(-5_000)).toBe('0s')
  })
})
