import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { FitAddon } from '@xterm/addon-fit'
import type { ITheme } from '@xterm/xterm'
import { useAppStore } from '@/store/index'
import { useTranslate } from '@/i18n/use-translate'
import { useSystemPrefersDark } from '@/hooks/theme/use-system-prefers-dark'
import { useEffectiveMacOptionAsAlt } from '@/lib/keyboard-layout/use-effective-mac-option-as-alt'
import { usePluginFontReady } from '@/store/plugins/appearance/plugin-fonts'
import { getRendererAppPlatform } from '@/app-shell/platform/renderer-app-platform'
import { composeActiveTerminalTheme } from '@/components/terminal-pane/appearance/terminal-appearance'
import { resolveEffectiveTerminalAppearance } from '@/lib/terminal/appearance/terminal-theme'
import {
  buildPreviewAppearanceOptions,
  buildPreviewTerminalOptions
} from '@/components/dashboard-popout/preview-terminal-options'
import { syncPreviewTerminalLigatures } from '@/components/dashboard-popout/preview-terminal-ligatures'
import { openStandaloneTerminal } from '@/components/standalone-terminal/open-standalone-terminal'
import type { StandaloneTerminal } from '@/components/standalone-terminal/open-standalone-terminal'
import { subscribeToPtyData } from '@/components/terminal-pane/pty-transport/delivery/pty-data-sidecar-subscriptions'
import { TerminalKittyKeyboardModeTracker } from '../../../../shared/terminal/protocol/input-modes/terminal-kitty-keyboard-mode-tracker'
import { buildClaudeAttachStartup } from '../../../../shared/ai-vault/resume/ai-vault-attach-startup'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { resolveTerminalMinimumContrastRatio } from '../../../../shared/terminal-themes/terminal-contrast-correction'

/** The history the attach keeps; the agent's transcript can be long. */
const ATTACH_SCROLLBACK_ROWS = 5000
/** The history the first snapshot carries; the stream alone starts mid-transcript. */
const ATTACH_SNAPSHOT_SCROLLBACK_ROWS = 500
/** The size the PTY starts at; the fit corrects it to the panel's real size. */
const ATTACH_FALLBACK_COLS = 80
const ATTACH_FALLBACK_ROWS = 24

/**
 * Whether the supervisor still shows this agent.
 *
 * The sidebar unmounts the whole panel when the user switches tabs, and React cannot tell that
 * apart from the user leaving the screen. The store can: the screen survives the unmount, so a
 * screen that still names this agent means the panel was merely unloaded.
 */
function stillShowingThisAgent(agentId: string): boolean {
  const screen = useAppStore.getState().backgroundAgentsScreen
  return screen.kind === 'agent' && screen.agentId === agentId
}

/**
 * The newest incarnation of the attach.
 *
 * A spawn can resolve after its screen was replaced; the older incarnation must not take the PTY
 * it spawned, or the newer screen's attach is orphaned.
 */
let currentAttachOwner: symbol | null = null

/**
 * The agent's own terminal, attached in place.
 *
 * The screen runs `claude attach`, so the user can talk to the agent and answer its permission
 * prompts. Leaving the screen kills the attach client and leaves the agent running; the left
 * arrow is Orca's way out and never reaches the agent.
 */
export function BackgroundAgentTerminal({
  agentId,
  cwd,
  onBack
}: {
  agentId: string
  cwd: string | null
  onBack: () => void
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const standaloneRef = useRef<StandaloneTerminal | null>(null)
  const onBackRef = useRef(onBack)
  const cwdRef = useRef(cwd)
  const t = useTranslate()
  const settings = useAppStore((state) => state.settings)
  const systemPrefersDark = useSystemPrefersDark()
  const macOptionAsAlt = useEffectiveMacOptionAsAlt(settings?.terminalMacOptionAsAlt)
  const terminalFontReady = usePluginFontReady(settings?.terminalFontFamily)
  // Why refs: the keys and the appearance read live values; a remount would hang up the attach.
  const settingsRef = useRef(settings)
  const macOptionAsAltRef = useRef(macOptionAsAlt)
  const attachFailedMessage = t(
    'auto.components.backgroundAgents.attachFailed',
    "The agent's terminal could not be opened"
  )
  const attachFailedRef = useRef(attachFailedMessage)
  const { theme, mode } = useMemo(() => {
    if (!settings) {
      return { theme: null, mode: 'dark' as const }
    }
    const appearance = resolveEffectiveTerminalAppearance(settings, systemPrefersDark)
    return {
      theme: composeActiveTerminalTheme(appearance.theme, settings),
      mode: appearance.mode
    }
  }, [settings, systemPrefersDark])
  const themeRef = useRef<{ theme: ITheme | null; mode: 'dark' | 'light' }>({ theme, mode })
  useLayoutEffect(() => {
    onBackRef.current = onBack
    cwdRef.current = cwd
    settingsRef.current = settings
    macOptionAsAltRef.current = macOptionAsAlt
    attachFailedRef.current = attachFailedMessage
    themeRef.current = { theme, mode }
  }, [onBack, cwd, settings, macOptionAsAlt, attachFailedMessage, theme, mode])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    let disposed = false
    let ptyId: string | null = null
    let unsubscribe: (() => void) | null = null
    let observer: ResizeObserver | null = null
    let resizeListener: { dispose: () => void } | null = null
    // Why: a spawn that resolves after this screen was replaced must not take the store.
    const owner = Symbol('background-agent-attach')
    currentAttachOwner = owner

    const attach = async (): Promise<void> => {
      // Why: the panel was unloaded and loaded again, so the attach client is still running.
      const existingPtyId = useAppStore.getState().backgroundAgentsAttachedPtyId
      let sessionPtyId: string
      if (existingPtyId) {
        sessionPtyId = existingPtyId
      } else {
        const startup = buildClaudeAttachStartup({
          platform: getRendererAppPlatform(),
          agentId,
          cwd: cwdRef.current
        })
        const spawned = await window.api.pty.spawn({
          cols: ATTACH_FALLBACK_COLS,
          rows: ATTACH_FALLBACK_ROWS,
          ...(startup.cwd ? { cwd: startup.cwd } : {}),
          command: startup.command,
          // Why: the provider delivers the command; the renderer never types it into a shell.
          commandDelivery: 'provider',
          // Why: this id is the only one exempt from being placed into a tab of its own.
          worktreeId: FLOATING_TERMINAL_WORKTREE_ID
        })
        if (disposed) {
          const state = useAppStore.getState()
          // Why: a newer incarnation owns the attach now, so publishing this id would orphan it.
          const superseded =
            currentAttachOwner !== owner || state.backgroundAgentsAttachedPtyId !== null
          if (!superseded && stillShowingThisAgent(agentId)) {
            state.setBackgroundAgentsAttachedPty(spawned.id)
          } else {
            void window.api.pty.kill(spawned.id)
          }
          return
        }
        sessionPtyId = spawned.id
      }
      ptyId = sessionPtyId
      useAppStore.getState().setBackgroundAgentsAttachedPty(sessionPtyId)

      const kittyKeyboardModes = new TerminalKittyKeyboardModeTracker({ kittyKeyboard: true })
      const standalone = openStandaloneTerminal({
        container,
        options: buildPreviewTerminalOptions({
          settings: settingsRef.current,
          terminalInput: null,
          macOptionIsMeta: macOptionAsAltRef.current === 'true',
          theme: themeRef.current.theme,
          themeMode: themeRef.current.mode,
          cols: ATTACH_FALLBACK_COLS,
          rows: ATTACH_FALLBACK_ROWS,
          scrollback: ATTACH_SCROLLBACK_ROWS
        }),
        kittyKeyboardModes,
        sessionKey: sessionPtyId,
        sendInput: (data) => {
          window.api.pty.write(sessionPtyId, data, 'driving')
          return true
        },
        // Why: this xterm is the attach's only emulator, so the agent's terminal queries need answers.
        answersQueries: true,
        getSettings: () => settingsRef.current,
        getMacOptionAsAlt: () => macOptionAsAltRef.current,
        getTerminalInput: () => null,
        claimKeyEvent: (event) => {
          // Why: Esc belongs to the Claude Code TUI; the screen's root claims it instead.
          if (event.key !== 'ArrowLeft') {
            return false
          }
          // Why: the modified arrows move the cursor (cmd+left is line start), so they belong to the agent.
          if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
            return false
          }
          // Why: the chord has to be claimed whole — a released arrow would reach xterm's kitty encoder.
          if (event.type === 'keydown' && !event.repeat) {
            event.preventDefault()
            event.stopPropagation()
            onBackRef.current()
          }
          return true
        }
      })
      if (!standalone) {
        // Why: the screen has nothing to show without a terminal, so the list is the honest place to be.
        toast.error(attachFailedRef.current)
        onBackRef.current()
        return
      }
      standaloneRef.current = standalone

      // Why: main hands the startup queries to this xterm and stops throttling the PTY.
      window.api.pty.setRendererPtyVisible(sessionPtyId, true)

      const snapshot = await window.api.pty.getMainBufferSnapshot(sessionPtyId, {
        scrollbackRows: ATTACH_SNAPSHOT_SCROLLBACK_ROWS
      })
      if (disposed) {
        return
      }
      if (snapshot?.data) {
        standalone.write(snapshot.data, { live: false })
      }
      // Why: the sidecar subscription acknowledges the bytes; a bare listener would stall the delivery.
      unsubscribe = subscribeToPtyData(sessionPtyId, (data) => {
        if (!disposed) {
          standalone.write(data, { live: true })
        }
      })

      const fit = new FitAddon()
      standalone.terminal.loadAddon(fit)
      resizeListener = standalone.terminal.onResize(({ cols, rows }) => {
        window.api.pty.resize(sessionPtyId, cols, rows)
      })
      observer = new ResizeObserver(() => {
        if (container.offsetWidth > 0 && container.offsetHeight > 0) {
          fit.fit()
        }
      })
      observer.observe(container)
      standalone.terminal.focus()
    }

    void attach().catch(() => {
      // Why: a PTY that could not start leaves nothing to show, so the list is the honest place to be.
      if (!disposed) {
        toast.error(attachFailedRef.current)
        onBackRef.current()
      }
    })

    return () => {
      disposed = true
      observer?.disconnect()
      resizeListener?.dispose()
      unsubscribe?.()
      standaloneRef.current?.dispose()
      standaloneRef.current = null
      // Why: leaving the screen kills the attach client, but an unload of the panel must not —
      // the agent keeps running and the screen re-attaches to the same PTY when it comes back.
      if (ptyId && !stillShowingThisAgent(agentId)) {
        void window.api.pty.kill(ptyId)
        useAppStore.getState().setBackgroundAgentsAttachedPty(null)
      }
    }
  }, [agentId])

  // Why appearance: the agent's terminal follows the app's theme and font like any other terminal.
  useEffect(() => {
    const terminal = standaloneRef.current?.terminal
    if (!terminal) {
      return
    }
    Object.assign(terminal.options, {
      ...buildPreviewAppearanceOptions(settings, macOptionAsAlt === 'true'),
      theme: theme ?? undefined,
      minimumContrastRatio: resolveTerminalMinimumContrastRatio(
        theme?.background,
        mode,
        settings?.terminalMinimumContrastRatio
      )
    })
    syncPreviewTerminalLigatures(terminal, settings)
  }, [settings, terminalFontReady, macOptionAsAlt, theme, mode])

  return (
    <div
      ref={containerRef}
      data-testid="background-agent-terminal"
      // Why: the app's close shortcuts must step aside for this terminal, or ⌘W closes the user's tab.
      data-agent-terminal-preview
      className="min-h-0 flex-1 overflow-hidden px-2 py-1"
    />
  )
}
