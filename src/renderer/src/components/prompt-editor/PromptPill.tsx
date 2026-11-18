import type { LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

/** The shell every attachment pill shares: an icon, a label and the selected ring. */
export function PromptPill({
  icon: Icon,
  label,
  selected,
  ...badgeProps
}: {
  icon: LucideIcon
  label: string
  selected: boolean
  title?: string
}): React.JSX.Element {
  return (
    <Badge variant="promptPill" data-selected={selected} {...badgeProps}>
      <Icon aria-hidden="true" />
      <span className="truncate">{label}</span>
    </Badge>
  )
}
