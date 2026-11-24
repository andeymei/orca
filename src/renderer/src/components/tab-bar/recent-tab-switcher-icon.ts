import {
  FileText,
  GitCompare,
  GitGraph,
  Globe2,
  Sparkles,
  TerminalSquare,
  type LucideIcon
} from 'lucide-react'

import type { RecentTabSwitcherItem } from './recent-switcher/recent-tab-switching'

/**
 * The icon a switcher row carries.
 *
 * Why a review has its own: the row shows the tab's own name, and a review of a file would
 * otherwise look like the file itself.
 */
export function recentTabSwitcherIcon(item: RecentTabSwitcherItem): LucideIcon {
  if (item.type === 'terminal') {
    return TerminalSquare
  }
  if (item.type === 'browser') {
    return Globe2
  }
  if (item.contentType === 'git-graph') {
    return GitGraph
  }
  if (item.contentType === 'refactor-review') {
    return Sparkles
  }
  if (
    item.contentType === 'diff' ||
    item.contentType === 'conflict-review' ||
    item.contentType === 'check-details'
  ) {
    return GitCompare
  }
  return FileText
}
