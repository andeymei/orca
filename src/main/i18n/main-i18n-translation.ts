import type { i18n as I18nInstance } from 'i18next'

import { createOrcaI18n } from '../../shared/orca-i18n-instance'
import type { SupportedUiLocale } from '../../shared/ui-locale'

/**
 * The main process's translation surface, without the system-locale half.
 *
 * Why it is its own module: the runtime runs headless in orcad and the CLI runs on plain Node,
 * where Electron is unavailable, so code they reach must not import the system-locale half.
 * Nothing here needs Electron, so the instance lives here and the Electron-aware half imports it.
 */

// English uses caller fallbacks; load only the selected non-English catalog after startup.
const LAZY_LOCALE_LOADERS: Record<
  Exclude<SupportedUiLocale, 'en'>,
  () => Promise<{ default: Record<string, unknown> }>
> = {
  de: () => import('../../renderer/src/i18n/locales/de.json'),
  es: () => import('../../renderer/src/i18n/locales/es.json'),
  fr: () => import('../../renderer/src/i18n/locales/fr.json'),
  ja: () => import('../../renderer/src/i18n/locales/ja.json'),
  ko: () => import('../../renderer/src/i18n/locales/ko.json'),
  pt: () => import('../../renderer/src/i18n/locales/pt.json'),
  ru: () => import('../../renderer/src/i18n/locales/ru.json'),
  tr: () => import('../../renderer/src/i18n/locales/tr.json'),
  zh: () => import('../../renderer/src/i18n/locales/zh.json'),
  'zh-Hant': () => import('../../renderer/src/i18n/locales/zh-Hant.json')
}
const LAZY_LOCALE_LOADER_MAP = new Map<string, () => Promise<{ default: Record<string, unknown> }>>(
  Object.entries(LAZY_LOCALE_LOADERS)
)

// Initializes synchronously, so startup dialogs can translate before settings load.
const orcaI18n = createOrcaI18n({
  loadCatalog: (language) => LAZY_LOCALE_LOADER_MAP.get(language)?.().then((mod) => mod.default),
  englishResources: {}
})

export const mainI18n: I18nInstance = orcaI18n.i18n
export const translateMain = orcaI18n.translate
export const setMainPluginLanguagePacks = orcaI18n.setPluginLanguagePacks

/** Maps a resolved UI locale to the resource language it is loaded under. */
export function resolveMainResourceLanguage(locale: string): string {
  return orcaI18n.resolveResourceLanguage(locale)
}
