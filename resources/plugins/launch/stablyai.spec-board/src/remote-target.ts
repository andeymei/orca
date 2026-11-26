// The file that holds a remote project's path.
//
// The path never goes into a prompt: it comes from another machine's filesystem, where a
// directory name may carry anything, and a prompt is read as instructions. The file's name
// carries an opaque id of the target, so the name is not the path either — the agent is told
// which file to read, and it reads the path out of it as data.

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { REMOTE_TARGET_MARKER, type RemoteProject } from './remote-host'
import { boardStoreDir, remoteTargetPath } from './store-paths'

/** An error the panel can act on: the host reads the code off the error. */
function failure(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/** Writes the file that holds a remote project's target, and returns its path. */
export async function writeRemoteTarget(remote: RemoteProject): Promise<string> {
  const key = createHash('sha256')
    .update(`${remote.host}\n${remote.path}`)
    .digest('hex')
    .slice(0, 16)
  const path = remoteTargetPath(key)
  try {
    await mkdir(boardStoreDir(), { recursive: true })
    await writeFile(
      path,
      `${JSON.stringify({ host: remote.host, path: remote.path }, null, 2)}\n`,
      'utf8'
    )
  } catch (error) {
    throw failure(
      'unavailable',
      `无法写入远程项目的目标文件：${error instanceof Error ? error.message : String(error)}`
    )
  }
  return path
}

/**
 * The prompt of a remote project's action, with the file that holds the path in it.
 *
 * A prompt without that file would send the agent to the wrong directory — the local one it
 * runs in — so it is refused rather than sent.
 */
export async function remotePrompt(prompt: string, remote: RemoteProject): Promise<string> {
  if (!prompt.includes(REMOTE_TARGET_MARKER)) {
    throw failure('invalid_params', '这个动作没有指向远程项目的路径')
  }
  const file = await writeRemoteTarget(remote)
  return prompt.replaceAll(REMOTE_TARGET_MARKER, file)
}
