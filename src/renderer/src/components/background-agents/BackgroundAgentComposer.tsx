import { Input } from '@/components/ui/input'
import { useTranslate } from '@/i18n/use-translate'

/**
 * The prompt box under the roster and the keys the panel answers.
 *
 * A host this version cannot command renders no composer: the prompt would have nowhere to run.
 */
export function BackgroundAgentComposer({
  value,
  onChange,
  onKeyDown,
  inputRef
}: {
  value: string
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  inputRef: React.Ref<HTMLInputElement>
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <>
      <div className="border-t border-border px-2 py-2">
        <Input
          ref={inputRef}
          density="compact"
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={t(
            'auto.components.backgroundAgents.composerPlaceholder',
            'Describe a task for a new session'
          )}
          aria-label={t('auto.components.backgroundAgents.composerLabel', 'New background agent')}
        />
      </div>
      <div className="px-2 pb-2 text-2xs text-muted-foreground">
        {t(
          'auto.components.backgroundAgents.shortcuts',
          '↑↓ select · enter enter · ctrl+x stop · / task'
        )}
      </div>
    </>
  )
}
