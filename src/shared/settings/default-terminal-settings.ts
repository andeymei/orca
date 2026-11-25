import type { GlobalSettings } from './global-settings-types'
import { DEFAULT_TERMINAL_FONT_WEIGHT_BOLD } from '../terminal/appearance/terminal-fonts'

/** The terminal defaults a new profile starts with. */
export type TerminalSettingsDefaults = Pick<
  GlobalSettings,
  | 'terminalFontSize'
  | 'terminalFontFamily'
  | 'terminalFontWeight'
  | 'terminalFontWeightWindowsRegular'
  | 'terminalFontWeightBold'
  | 'terminalLineHeight'
  | 'terminalScrollSensitivity'
  | 'terminalFastScrollSensitivity'
  | 'terminalTuiScrollSensitivity'
  | 'terminalTuiScrollSensitivityDefaultedToOne'
  | 'terminalGpuAcceleration'
  | 'terminalLigatures'
  | 'terminalInlineImages'
  | 'terminalDroppedImagesPreview'
  | 'terminalCursorStyle'
  | 'terminalCursorStyleDefaultedToBlock'
  | 'terminalCursorBlink'
  | 'terminalThemeDark'
  | 'terminalDividerColorDark'
  | 'terminalUseSeparateLightTheme'
  | 'terminalColorOverridesSplit'
  | 'terminalThemeLight'
  | 'claudeCodeThemeSync'
  | 'terminalCustomThemes'
  | 'terminalDividerColorLight'
  | 'terminalInactivePaneOpacity'
  | 'terminalActivePaneOpacity'
  | 'terminalPaneOpacityTransitionMs'
  | 'terminalDividerThicknessPx'
  | 'terminalRightClickToPaste'
  | 'terminalRightClickToPasteDefaultedForPlatform'
  | 'terminalWindowsShell'
  | 'terminalDefaultShell'
  | 'terminalWindowsWslDistro'
>

/** The terminal defaults, with the fonts the host asked for. */
export function defaultTerminalSettings(args: {
  terminalFontFamily: string
  terminalFontWeight: number
  terminalFontWeightWindowsRegular?: GlobalSettings['terminalFontWeightWindowsRegular']
  terminalInactivePaneOpacity: number
  terminalRightClickToPaste: boolean
}): TerminalSettingsDefaults {
  return {
    terminalFontSize: 14,
    terminalFontFamily: args.terminalFontFamily,
    terminalFontWeight: args.terminalFontWeight,
    terminalFontWeightWindowsRegular: args.terminalFontWeightWindowsRegular,
    terminalFontWeightBold: DEFAULT_TERMINAL_FONT_WEIGHT_BOLD,
    terminalLineHeight: 1,
    terminalScrollSensitivity: 1.15,
    terminalFastScrollSensitivity: 5,
    terminalTuiScrollSensitivity: 1,
    terminalTuiScrollSensitivityDefaultedToOne: true,
    // Why: "auto" uses WebGL when supported, falling back to DOM on renderer failure or software/unknown GPU.
    terminalGpuAcceleration: 'auto',
    // Why 'auto': enable ligatures only for known ligature fonts, never forced. Resolver in shared/terminal-ligatures.ts.
    terminalLigatures: 'auto',
    // Lazy image addon stays off the critical path and creates canvas layers only on first image; decoder setup still has overhead.
    terminalInlineImages: true,
    terminalDroppedImagesPreview: true,
    terminalCursorStyle: 'block',
    terminalCursorStyleDefaultedToBlock: true,
    terminalCursorBlink: true,
    terminalThemeDark: 'Ghostty Default Style Dark',
    terminalDividerColorDark: '#3f3f46',
    terminalUseSeparateLightTheme: true,
    terminalColorOverridesSplit: true,
    terminalThemeLight: 'Builtin Tango Light',
    claudeCodeThemeSync: false,
    terminalCustomThemes: [],
    terminalDividerColorLight: '#d4d4d8',
    terminalInactivePaneOpacity: args.terminalInactivePaneOpacity,
    terminalActivePaneOpacity: 1,
    terminalPaneOpacityTransitionMs: 140,
    terminalDividerThicknessPx: 3,
    // Why: Windows paste-on-right-click matches native convention; macOS/Linux keep right-click for the context menu.
    terminalRightClickToPaste: args.terminalRightClickToPaste,
    terminalRightClickToPasteDefaultedForPlatform: true,
    terminalWindowsShell: 'powershell.exe',
    terminalDefaultShell: '',
    terminalWindowsWslDistro: null
  }
}
