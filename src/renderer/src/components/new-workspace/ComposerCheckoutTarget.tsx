import { useId } from 'react'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { TaskCheckoutTarget } from '../../../../shared/new-workspace/task-checkout-target'
import { isTaskCheckoutTarget } from '../../../../shared/new-workspace/task-checkout-target'

type Props = {
  value: TaskCheckoutTarget
  onChange: (next: TaskCheckoutTarget) => void
  /** Branch the project's own checkout has, e.g. main; null when it has none to develop on. */
  currentCheckoutBranch: string | null
}

export function ComposerCheckoutTarget({
  value,
  onChange,
  currentCheckoutBranch
}: Props): React.JSX.Element {
  const t = useTranslate()
  const id = useId()
  const title = t('workspace.checkoutTarget.title', 'Where the task runs')
  const currentCheckoutLabel = currentCheckoutBranch
    ? t('workspace.checkoutTarget.currentWithBranch', 'Current checkout ({{branch}})', {
        branch: currentCheckoutBranch
      })
    : t('workspace.checkoutTarget.current', 'Current checkout')
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-xs font-medium text-muted-foreground">{title}</legend>
      <RadioGroup
        aria-label={title}
        value={value}
        onValueChange={(next) => {
          if (isTaskCheckoutTarget(next)) {
            onChange(next)
          }
        }}
      >
        <div
          className={cn(
            'min-w-0 rounded-md border border-border',
            value === 'new-workspace' && 'bg-accent/50 text-accent-foreground'
          )}
        >
          <label className="flex cursor-pointer items-start gap-2 p-3">
            <RadioGroupItem
              value="new-workspace"
              className="mt-0.5"
              aria-labelledby={`${id}-new-workspace`}
              aria-describedby={`${id}-new-workspace-description`}
            />
            <span className="min-w-0 space-y-1">
              <span id={`${id}-new-workspace`} className="block text-xs font-medium">
                {t('workspace.checkoutTarget.newWorkspace', 'New workspace')}
              </span>
              <span
                id={`${id}-new-workspace-description`}
                className="block text-xs text-muted-foreground"
              >
                {t(
                  'workspace.checkoutTarget.newWorkspaceHint',
                  'Create a branch and a separate worktree for this task.'
                )}
              </span>
            </span>
          </label>
        </div>
        <div
          className={cn(
            'min-w-0 rounded-md border border-border',
            value === 'current-checkout' && 'bg-accent/50 text-accent-foreground'
          )}
        >
          <label className="flex cursor-pointer items-start gap-2 p-3">
            <RadioGroupItem
              value="current-checkout"
              className="mt-0.5"
              disabled={!currentCheckoutBranch}
              aria-labelledby={`${id}-current-checkout`}
              aria-describedby={`${id}-current-checkout-description`}
            />
            <span className="min-w-0 space-y-1">
              <span id={`${id}-current-checkout`} className="block text-xs font-medium">
                {currentCheckoutLabel}
              </span>
              <span
                id={`${id}-current-checkout-description`}
                className="block text-xs text-muted-foreground"
              >
                {currentCheckoutBranch
                  ? t(
                      'workspace.checkoutTarget.currentCheckoutHint',
                      'Run the task in the project’s existing checkout. The agent branches only if it needs to.'
                    )
                  : t(
                      'workspace.checkoutTarget.currentCheckoutUnavailableHint',
                      'This project has no checkout to run in yet.'
                    )}
              </span>
            </span>
          </label>
        </div>
      </RadioGroup>
    </fieldset>
  )
}
