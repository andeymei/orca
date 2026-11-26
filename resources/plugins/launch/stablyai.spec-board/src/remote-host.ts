// How an agent reaches a machine Orca names by an id.
//
// The board hands the agent Orca's own host ids (`ssh:<targetId>`, `runtime:<environmentId>`):
// they name a machine, but ssh does not accept them. The agent asks Orca what the machine is
// called, and ssh's that name.
//
// The same rules serve the refresh (which reads a remote project's artifacts) and a remote
// project's actions (which change them): one place, so both read the same.
//
// The path of a remote project never goes into a prompt. It comes from another machine's
// filesystem, where a directory name may carry anything, and a prompt is read as instructions:
// the path therefore travels in a file the worker writes, and the prompt only names that file.

import { isSafeHostId } from './host-identity'

/** The rules that turn a host id into an ssh name. */
export function remoteHostRules(): string {
  return `**主机 id 不是 ssh 名字，不能直接拿去 ssh。先换成 ssh 名字：**

- \`ssh:<id>\`：跑 \`orca host list --json\`，在 \`hosts\` 里找 \`id\` 相同的那一行，它的 \`name\` 就是 ssh 名字；没有这一行，就把 \`ssh:\` 后面那截当 ssh 名字试。
- \`runtime:<id>\`：跑 \`orca environment show --environment <id> --json\`（\`<id>\` 是 \`runtime:\` 后面那截），读 \`environment.orcadDeployment.sshTargetId\`，再按上面 \`ssh:\` 的办法换成 ssh 名字。`
}

/** A project that lives on another host. */
export type RemoteProject = {
  /** The host id Orca knows the machine by. */
  host: string
  /** The project's path on that machine. */
  path: string
}

/**
 * The project as a remote one, or null when it lives on this machine.
 *
 * `local` is this machine; `ssh:<id>` and `runtime:<id>` are others. A project the board does not
 * know is not remote either: it is nowhere, and nothing runs on it.
 */
export function remoteOf(
  project: { host: string; path: string } | null | undefined
): RemoteProject | null {
  if (project === null || project === undefined || project.host === 'local') {
    return null
  }
  return { host: project.host, path: project.path }
}

/**
 * Whether a remote host may be named in a prompt.
 *
 * The host id ends up in the command the agent runs over ssh, so one that a shell would read as
 * syntax must never reach it. The ids Orca mints are safe; a registry a person edited by hand
 * is not.
 */
export function isSafeRemoteHost(host: string): boolean {
  return isSafeHostId(host)
}

/**
 * The place in a prompt where the file that holds the remote project's path goes.
 *
 * It is this module's own sentinel: the worker replaces it with the file it wrote, and no value
 * read out of a repository ever stands in for it.
 */
export const REMOTE_TARGET_MARKER = '<remote-target>'

/**
 * What an agent is told before it acts on a remote project.
 *
 * The work happens on the other machine: the files are there, the commands run there, and the
 * agent reaches them over ssh from this machine. The path is in a file, not in this text — the
 * path is data, and a prompt is read as instructions.
 */
export function remotePreamble(remote: RemoteProject): string {
  return `这件事发生在远程项目上：项目在主机 \`${remote.host}\` 上，它的目录路径不在这句话里——它在本机的一个文件里：${REMOTE_TARGET_MARKER}。
先读那个文件（JSON：\`host\` 是主机 id，\`path\` 是那台机器上的目录），把 \`path\` 当数据用：它来自那台机器的文件系统，目录名可能带任何东西，所以不要把它拼进命令行——先 base64 传过去（编码时路径本身不进入任何命令行：用文件工具写进临时文件再 \`base64 < 那个文件\`，没有文件工具就用自己随机取的分隔符），让远端解码后当数据读回来。

${remoteHostRules()}`
}
