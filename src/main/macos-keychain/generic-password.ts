import { execFile } from 'node:child_process'

// A macOS authorization dialog needs a human to answer it. Three seconds is not enough time to
// read it and pick a button, and the poll that asks for it runs again every 30 seconds.
const KEYCHAIN_COMMAND_TIMEOUT_MS = 30_000

// How long to leave an unanswered prompt alone. The user grants access once, for good, by
// choosing "Always Allow"; until they do, re-raising the dialog on every poll is noise.
const KEYCHAIN_PROMPT_COOLDOWN_MS = 10 * 60_000

type SecurityCommandResult = {
  stdout: string
  stderr: string
}

export function isKeychainNotFoundError(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined
  const message =
    error && typeof error === 'object'
      ? `${String((error as { stderr?: unknown }).stderr ?? '')} ${String(
          (error as { message?: unknown }).message ?? ''
        )}`.toLowerCase()
      : String(error).toLowerCase()
  return code === 44 || message.includes('could not be found') || message.includes('not be found')
}

// Items whose macOS prompt was left unanswered. The poll that asks for them runs every 30
// seconds, so without this the dialog flashes on and off faster than anyone can answer it.
const suppressedPrompts = new Map<string, number>()

function promptKey(service: string, account: string): string {
  return `${service}\u0000${account}`
}

function isPromptSuppressed(service: string, account: string): boolean {
  const key = promptKey(service, account)
  const until = suppressedPrompts.get(key)
  if (until === undefined) {
    return false
  }
  if (until <= Date.now()) {
    suppressedPrompts.delete(key)
    return false
  }
  return true
}

function suppressPrompt(service: string, account: string): void {
  const key = promptKey(service, account)
  if (suppressedPrompts.has(key)) {
    return
  }
  suppressedPrompts.set(key, Date.now() + KEYCHAIN_PROMPT_COOLDOWN_MS)
  console.warn(
    `[keychain] macOS asked for permission to read the "${service}" keychain item and the request was not answered. ` +
      'Choose "Always Allow" in that dialog to let Orca read it once, for good; until then Orca stops asking.'
  )
}

export function resetKeychainPromptSuppressionForTests(): void {
  suppressedPrompts.clear()
}

export function execSecurityCommand(args: string[]): Promise<SecurityCommandResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    let child: ReturnType<typeof execFile> | undefined
    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      child?.kill()
      reject(
        Object.assign(new Error(`security timed out after ${KEYCHAIN_COMMAND_TIMEOUT_MS}ms`), {
          code: 'ETIMEDOUT',
          stderr: ''
        })
      )
    }, KEYCHAIN_COMMAND_TIMEOUT_MS)

    const settle = (callback: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      callback()
    }

    // execFile timeout signals the child; the outer timer also settles a callback that never returns.
    try {
      child = execFile(
        'security',
        args,
        { timeout: KEYCHAIN_COMMAND_TIMEOUT_MS },
        (error, stdout, stderr) => {
          if (error) {
            settle(() =>
              reject(
                Object.assign(error, {
                  stdout: String(stdout),
                  stderr: String(stderr)
                })
              )
            )
            return
          }
          settle(() => resolve({ stdout: String(stdout), stderr: String(stderr) }))
        }
      )
    } catch (error) {
      settle(() => reject(error))
    }
  })
}

export async function readKeychainPassword(
  service: string,
  account: string,
  run: typeof execSecurityCommand = execSecurityCommand
): Promise<string | null> {
  if (process.platform !== 'darwin') {
    return null
  }
  if (isPromptSuppressed(service, account)) {
    return null
  }
  try {
    const { stdout } = await run(['find-generic-password', '-s', service, '-a', account, '-w'])
    if (stdout.trim()) {
      return stdout.trim()
    }
    throw new Error(`Could not read macOS Keychain item ${service}/${account}.`)
  } catch (error) {
    if (isKeychainNotFoundError(error)) {
      return null
    }
    suppressPrompt(service, account)
    throw error
  }
}
