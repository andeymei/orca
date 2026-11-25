/** Scan a workspace tree for file paths with the bundled ripgrep and hand each path to a ranker. */
import type { QuickOpenPathRanker } from '../../../../shared/quick-open/quick-open-path-search'
import { getQuickOpenRgOutputMode } from '../../../../shared/quick-open/quick-open-ripgrep-output-mode'
import {
  normalizeQuickOpenRgLine,
  shouldExcludeQuickOpenRelPath,
  shouldIncludeQuickOpenPath
} from '../../../../shared/quick-open/quick-open-filter'
import { RipgrepFilenameDecoder } from '../../../../shared/ripgrep/ripgrep-filename-decoder'
import { fileListingCancellationError } from '../../../../shared/file-listing/file-listing-cancellation'
import { toWindowsWslPath } from '../../../../shared/file-access/wsl-paths'
import { QuickOpenSubprocessPathAccumulator } from '../../../../shared/quick-open/quick-open-subprocess-path-accumulator'
import { spawnBundledRipgrep } from '../../../ripgrep/bundled-ripgrep-spawn'
import {
  absorbPendingRipgrepSpawnError,
  classifySynchronousRipgrepSpawnFailure,
  isRipgrepMissingCwdExit,
  isRipgrepSpawnCwdUsable,
  isRipgrepUnavailableExit,
  isTransientRipgrepSpawnError,
  killSpawnedRipgrepProcess,
  ripgrepMissingCwdError,
  RipgrepLaunchFailureError,
  RipgrepUnavailableError
} from '../../../../shared/ripgrep/ripgrep-process-availability'

export function scanRipgrepPaths(args: {
  args: string[]
  authorizedRootPath: string
  excludePathPrefixes: readonly string[]
  wslDistro?: string
  ranker: QuickOpenPathRanker
  signal?: AbortSignal
  wslDistroForOutput?: string
}): Promise<void> {
  if (args.signal?.aborted) {
    return Promise.reject(fileListingCancellationError(args.signal))
  }
  return new Promise((resolve, reject) => {
    const filenameDecoder = new RipgrepFilenameDecoder((error) => {
      killSpawnedRipgrepProcess(child)
      finish(error)
    }, Boolean(args.wslDistroForOutput))
    const pathAccumulator = new QuickOpenSubprocessPathAccumulator(0)
    let done = false
    let parseablePathCount = 0
    let processErrorObserved = false
    let unavailableExitObserved = false
    let child: ReturnType<typeof spawnBundledRipgrep>
    try {
      child = spawnBundledRipgrep(args.args, {
        cwd: args.authorizedRootPath,
        wslDistro: args.wslDistro,
        wslDistroForOutput: args.wslDistroForOutput,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      // Classify synchronous failures too, including file-shaped roots returning ENOTDIR.
      void classifySynchronousRipgrepSpawnFailure(error, args.authorizedRootPath).then(
        reject,
        reject
      )
      return
    }
    let timer: ReturnType<typeof setTimeout>

    const processLine = (rawLine: string): void => {
      const translated =
        args.wslDistroForOutput && rawLine.startsWith('/')
          ? toWindowsWslPath(rawLine, args.wslDistroForOutput)
          : rawLine
      const relPath = normalizeQuickOpenRgLine(
        translated,
        getQuickOpenRgOutputMode(rawLine, translated, args.authorizedRootPath)
      )
      if (relPath === null) {
        return
      }
      parseablePathCount++
      if (
        shouldIncludeQuickOpenPath(relPath) &&
        !shouldExcludeQuickOpenRelPath(relPath, args.excludePathPrefixes)
      ) {
        args.ranker.consider(relPath)
      }
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      child.stdout?.off('data', handleStdoutData)
      child.stderr?.off('data', handleStderrData)
      child.off('error', handleError)
      child.off('close', handleClose)
      args.signal?.removeEventListener('abort', handleAbort)
      absorbPendingRipgrepSpawnError(child, {
        errorObserved: processErrorObserved,
        unavailableExitObserved
      })
    }
    const finish = (error?: Error): void => {
      if (done) {
        return
      }
      done = true
      cleanup()
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const handleStdoutData = (chunk: Buffer | string): void => {
      const decoded = filenameDecoder.decode(chunk)
      if (decoded === null) {
        return
      }
      const result = pathAccumulator.push(decoded, (path) => {
        processLine(path)
        return true
      })
      if (result === 'path-too-large') {
        killSpawnedRipgrepProcess(child)
        finish(new Error('Quick Open file path exceeds the listing limit'))
      }
    }
    const handleStderrData = (): void => {
      /* drain */
    }
    const handleError = (error: NodeJS.ErrnoException): void => {
      processErrorObserved = true
      if (isTransientRipgrepSpawnError(error)) {
        finish(new RipgrepLaunchFailureError(`rg failed to start (${error.code})`))
        return
      }
      if (!isRipgrepUnavailableExit(child, null, null)) {
        finish(new Error(`rg failed to start${error.code ? ` (${error.code})` : ''}`))
        return
      }
      // ENOENT may mean missing cwd; detach close first so its synchronous failure cannot race the async probe.
      child.off('close', handleClose)
      // A failed cwd probe must not strand the search; preserve the prior classification.
      void isRipgrepSpawnCwdUsable(args.authorizedRootPath)
        .catch(() => true)
        .then((usable) => {
          finish(
            usable ? new RipgrepUnavailableError() : ripgrepMissingCwdError(args.authorizedRootPath)
          )
        })
    }
    const handleClose = (code: number | null, signal: NodeJS.Signals | null): void => {
      // WSL missing-cwd code 97 would otherwise be classified as a broken install.
      if (isRipgrepMissingCwdExit(code)) {
        pathAccumulator.clear()
        finish(ripgrepMissingCwdError(args.authorizedRootPath))
        return
      }
      if (
        isRipgrepUnavailableExit(child, code, signal, {
          classifyNativeLauncherExit: true
        })
      ) {
        unavailableExitObserved = true
        finish(new RipgrepUnavailableError())
        return
      }
      if (signal) {
        finish(new Error(`rg killed by ${signal}`))
        return
      }
      if (!filenameDecoder.finish()) {
        return
      }
      const trailingPath = pathAccumulator.finish()
      if (trailingPath) {
        processLine(trailingPath)
      }
      finish(
        code === 0 || code === 1 || (code === 2 && parseablePathCount > 0)
          ? undefined
          : new Error(`rg exited with code ${code}`)
      )
    }
    const handleAbort = (): void => {
      pathAccumulator.clear()
      killSpawnedRipgrepProcess(child)
      finish(fileListingCancellationError(args.signal))
    }

    child.stdout?.on('data', handleStdoutData)
    child.stderr?.on('data', handleStderrData)
    child.once('error', handleError)
    child.once('close', handleClose)
    args.signal?.addEventListener('abort', handleAbort, { once: true })
    timer = setTimeout(() => {
      pathAccumulator.clear()
      killSpawnedRipgrepProcess(child)
      finish(new Error('rg file-path search timed out'))
    }, 10_000)
    if (args.signal?.aborted) {
      handleAbort()
    }
  })
}
