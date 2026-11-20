import { useTranslate } from '@/i18n/use-translate'

/**
 * What the panel says when the open workspace's agents do not live on this machine.
 *
 * A paired runtime can list its agents — the panel reads its job files — but cannot open or
 * command them yet. An SSH host cannot answer the listing at all.
 */
export function BackgroundAgentHostNotice({
  hostKind
}: {
  hostKind: 'runtime' | 'ssh' | null
}): React.JSX.Element | null {
  const t = useTranslate()
  if (hostKind === 'runtime') {
    return (
      <div
        data-testid="background-agents-remote-host-notice"
        className="px-2 pt-1 text-2xs text-muted-foreground"
      >
        {t(
          'auto.components.backgroundAgents.remoteHostNotice',
          "Showing this project's agents on its host. Opening, stopping and starting them there is not supported yet."
        )}
      </div>
    )
  }
  if (hostKind === 'ssh') {
    return (
      <div
        data-testid="background-agents-local-only-notice"
        className="px-2 pt-1 text-2xs text-muted-foreground"
      >
        {t(
          'auto.components.backgroundAgents.localOnlyNotice',
          'This panel lists background agents running on this machine'
        )}
      </div>
    )
  }
  return null
}
