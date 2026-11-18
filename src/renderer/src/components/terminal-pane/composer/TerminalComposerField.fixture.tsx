import { defineFixture } from '../../../component-fixtures/component-fixture'
import {
  fileReferenceContent,
  imageReferenceContent
} from '@/components/prompt-editor/prompt-editor-nodes'
import { TerminalComposerField } from './TerminalComposerField'

const paneKey = 'tab1:leaf1'
const host = { workspacePath: '/home/dev/project', worktreeId: 'worktree-1' }

function Composer(): React.JSX.Element {
  return (
    <div className="w-[680px] rounded-lg border border-border bg-popover p-2 shadow-lg">
      <TerminalComposerField
        paneKey={paneKey}
        disabled={false}
        buildHost={() => host}
        onSend={() => {}}
        onAttach={() => {}}
        onDismiss={() => {}}
      />
    </div>
  )
}

export const empty = defineFixture({
  width: 720,
  render: () => <Composer />
})

export const withAttachments = defineFixture({
  width: 720,
  store: {
    terminalComposerDraftByPaneKey: {
      [paneKey]: {
        document: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Look at ' },
                fileReferenceContent('/home/dev/project/.orca/drops/notes.txt'),
                { type: 'text', text: ' and ' },
                imageReferenceContent('a1', 'shot.png'),
                { type: 'text', text: ' when you can.' }
              ]
            }
          ]
        },
        attachments: [
          {
            id: 'a1',
            name: 'shot.png',
            workspacePath: '/home/dev/project/.orca/drops/shot.png',
            isImage: true
          },
          {
            id: 'f1',
            name: 'notes.txt',
            workspacePath: '/home/dev/project/.orca/drops/notes.txt',
            isImage: false
          }
        ]
      }
    }
  },
  render: () => <Composer />
})
