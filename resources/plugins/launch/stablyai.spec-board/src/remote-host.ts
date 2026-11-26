// How an agent reaches a machine Orca names by an id.
//
// The board hands the agent Orca's own host ids (`ssh:<targetId>`, `runtime:<environmentId>`):
// they name a machine, but ssh does not accept them. The agent asks Orca what the machine is
// called, and ssh's that name.
//
// The refresh reads a remote project's artifacts from this machine, so its agent has to reach
// that machine over ssh — the rules below are what tell it how. A remote project's *action* does
// not need them: Orca starts that agent on the server that holds the project, in the project's
// own workspace there, and the work happens where the files are.

/** The rules that turn a host id into an ssh name. */
export function remoteHostRules(): string {
  return `**主机 id 不是 ssh 名字，不能直接拿去 ssh。先换成 ssh 名字：**

- \`ssh:<id>\`：跑 \`orca host list --json\`，在 \`hosts\` 里找 \`id\` 相同的那一行，它的 \`name\` 就是 ssh 名字；没有这一行，就把 \`ssh:\` 后面那截当 ssh 名字试。
- \`runtime:<id>\`：跑 \`orca environment show --environment <id> --json\`（\`<id>\` 是 \`runtime:\` 后面那截），读 \`environment.orcadDeployment.sshTargetId\`，再按上面 \`ssh:\` 的办法换成 ssh 名字。

**换出来的名字先自己查一遍再用**：只能是一个主机名（不能有空格、引号、shell 记号或 \`=\`，不能以 \`-\` 开头）；不合就换个来源找，别拿它去连。ssh 写成 \`ssh -- <名字> …\`。`
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

