import { defineFixture } from '../../component-fixtures/component-fixture'
import { BackgroundAgentComposer } from './BackgroundAgentComposer'

const host = { workspacePath: '/home/dev/project', worktreeId: 'worktree-1' }

function Composer(): React.JSX.Element {
  return (
    <div className="w-[320px] bg-background">
      <BackgroundAgentComposer
        onSend={() => {}}
        onCommand={() => {}}
        onDismiss={() => {}}
        buildHost={() => host}
      />
    </div>
  )
}

export const empty = defineFixture({
  width: 320,
  render: () => <Composer />
})
