// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NesNextEditNotice } from './nes-next-edit-notice'
import type { NesNextEdit } from './nes-next-edit'

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

function render(props: { nextEdit: NesNextEdit; onJump?: () => void }): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root?.render(
      <NesNextEditNotice nextEdit={props.nextEdit} onJump={props.onJump ?? (() => {})} />
    )
  })
  return container
}

describe('the next-edit notice', () => {
  it('names the line of an edit the cursor cannot show', () => {
    const container = render({
      nextEdit: { kind: 'elsewhere', lineNumber: 34, label: 'add the import' }
    })
    const button = container.querySelector('button')
    expect(button?.textContent).toContain('Next edit')
    expect(button?.textContent).toContain('L34')
    // Why: the model's own words name the edit, so the notice needs no translation of them.
    expect(button?.getAttribute('title')).toBe('add the import')
  })

  it('jumps to the edit when it is clicked', () => {
    const onJump = vi.fn()
    const container = render({
      nextEdit: { kind: 'elsewhere', lineNumber: 34, label: 'add the import' },
      onJump
    })
    const button = container.querySelector('button')
    act(() => {
      button?.click()
    })
    expect(onJump).toHaveBeenCalledTimes(1)
  })

  it('says a rewrite needs a held Alt, because a ghost text draws no deletion', () => {
    const container = render({
      nextEdit: { kind: 'rewrite', lineNumber: 5, label: 'rename the constant' }
    })
    expect(container.textContent).toContain('Rewrite here')
    expect(container.textContent).toContain('hold Alt to preview')
    // Why: the model's own words name the rewrite, so the chip says what it is on hover.
    expect(container.querySelector('[title]')?.getAttribute('title')).toBe('rename the constant')
  })
})
