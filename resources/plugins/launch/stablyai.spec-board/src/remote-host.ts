// How an agent reaches a machine Orca names by an id.
//
// The board hands the agent Orca's own host ids (`ssh:<targetId>`, `runtime:<environmentId>`):
// they name a machine, but ssh does not accept them. The agent asks Orca what the machine is
// called, and ssh's that name.
//
// The same rules serve the refresh (which reads a remote project's artifacts) and a remote
// project's actions (which change them): one place, so both read the same.

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
 * What an agent is told before it acts on a remote project.
 *
 * The work happens on the other machine: the files are there, the commands run there, and the
 * agent reaches them over ssh from this machine.
 */
export function remotePreamble(remote: RemoteProject): string {
  return `这件事发生在远程项目上：项目在主机 \`${remote.host}\` 的 \`${remote.path}\`。
产物和命令都在那台机器上——不要在本机找这个目录，也不要把本机的同名目录当成它。
先按下面的规则把那台机器的 ssh 名字问出来，再 ssh 过去操作那个目录。

${remoteHostRules()}`
}
