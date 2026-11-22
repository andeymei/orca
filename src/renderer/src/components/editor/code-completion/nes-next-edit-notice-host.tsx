import type { editor } from 'monaco-editor'
import { NesNextEditNotice } from './nes-next-edit-notice'
import type { NesNextEdit } from './nes-next-edit'
import { nesShortcutHandlersFor } from './nes-editor-feature'

/**
 * The notice that names the place the cursor cannot show.
 *
 * Why it lives apart from the editor: the notice is the feature's, and the editor only has to
 * say where the editor is.
 */
export function NesNextEditNoticeHost(props: {
  editorInstance: editor.IStandaloneCodeEditor | null
  nextEdit: NesNextEdit
}): React.JSX.Element {
  return (
    <NesNextEditNotice
      nextEdit={props.nextEdit}
      onJump={() => {
        // Why: the jump chord is the one that moves to the next location, so the notice
        // lands the user exactly where the model meant.
        if (props.editorInstance) {
          nesShortcutHandlersFor(props.editorInstance)?.jump()
        }
      }}
    />
  )
}
