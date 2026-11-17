import type { SecretAtRestProtection } from '../secret-at-rest-protection'

export type CodeCompletionCredentialsStatus = {
  configured: boolean
  /** How the stored key sits on disk, so the settings UI can warn when it is unsealed. */
  protection: SecretAtRestProtection | null
}
