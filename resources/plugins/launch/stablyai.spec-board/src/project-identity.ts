// The id a project keeps across scans: the host it lives on, and where.
//
// A project's path is the path of its own checkout, so the id says which directory on which
// machine the board's facts are about. The same directory on two hosts is two projects, and the
// host is what tells them apart.

export function projectIdFor(host: string, path: string): string {
  return `${host}|${path}`
}
