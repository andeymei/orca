import { Bot } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'

/** Opens the chats that kept running while Orca was closed, so one can be picked back up. */
export function TabBarBackgroundAgentsItem(): React.JSX.Element {
  const t = useTranslate()
  return (
    <DropdownMenuItem
      variant="launch"
      onSelect={() => useAppStore.getState().openModal('background-agents')}
    >
      <Bot className="size-4 text-muted-foreground" />
      {t('auto.components.tab.bar.TabBarBackgroundAgentsItem.label', 'Background agents…')}
    </DropdownMenuItem>
  )
}
