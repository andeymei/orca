import { defineFixture } from '../../../component-fixtures/component-fixture'
import { NesNextEditNotice } from './nes-next-edit-notice'
import type { NesNextEdit } from './nes-next-edit'

const SOURCE = [
  'List<String> ets=new ArrayList();',
  'IFireHost fireHost;',
  '',
  'private int getGwNo(){',
  '    ',
  '}'
]

/** The notice over a stand-in for the editor surface, so its place in the pane is visible. */
function NoticePreview(props: { nextEdit: NesNextEdit }): React.ReactElement {
  return (
    <div
      style={{
        position: 'relative',
        height: 150,
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'var(--editor-surface)',
        padding: 12
      }}
    >
      <pre
        style={{
          margin: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          lineHeight: 1.5,
          color: 'var(--foreground)'
        }}
      >
        {SOURCE.join('\n')}
      </pre>
      <NesNextEditNotice nextEdit={props.nextEdit} onJump={() => {}} />
    </div>
  )
}

export const elsewhere = defineFixture({
  width: 700,
  render: () => (
    <NoticePreview nextEdit={{ kind: 'elsewhere', lineNumber: 34, label: 'add the import' }} />
  )
})

export const rewrite = defineFixture({
  width: 700,
  render: () => (
    <NoticePreview nextEdit={{ kind: 'rewrite', lineNumber: 5, label: 'rename the constant' }} />
  )
})
