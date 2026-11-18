import type { ComponentProps } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

/** The host hooks a pill by a data attribute; the shell hands those through untouched. */
export type PromptPillProps = Omit<ComponentProps<'span'>, 'children'> &
  Record<`data-${string}`, string | undefined> & {
    icon: LucideIcon
    label: string
    selected: boolean
  }

/** The shell every attachment pill shares: an icon, a label and the selected ring. */
export function PromptPill({
  icon: Icon,
  label,
  selected,
  ...badgeProps
}: PromptPillProps): React.JSX.Element {
  return (
    <Badge variant="promptPill" data-selected={selected} {...badgeProps}>
      <Icon aria-hidden="true" />
      <span className="truncate">{label}</span>
    </Badge>
  )
}
