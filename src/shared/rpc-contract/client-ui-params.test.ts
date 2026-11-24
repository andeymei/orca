import { describe, expect, it } from 'vitest'
import { UiUpdate } from './client-ui/client-ui-params'

describe('UiUpdate', () => {
  it('drops a right sidebar tab the app no longer knows and keeps the rest of the payload', () => {
    const result = UiUpdate.parse({
      rightSidebarTab: 'background-agents',
      sidebarWidth: 300
    })
    expect(result).toEqual({ sidebarWidth: 300 })
  })
})
