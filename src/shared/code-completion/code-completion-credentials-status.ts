import type { SecretAtRestProtection } from '../secret-at-rest-protection'

export type CodeCompletionCredentialsStatus = {
  configured: boolean
  /** How the stored key sits on disk, so the settings UI can warn when it is unsealed. */
  protection: SecretAtRestProtection | null
  /** Set when the saved file cannot be used here: 'sealed-elsewhere' means the other Orca app
   *  on that machine (desktop vs orcad) saved it. */
  unreadable?: 'sealed-elsewhere' | 'unreadable'
}
