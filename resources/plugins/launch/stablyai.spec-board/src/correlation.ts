// Pairs an OpenSpec change with the Superpowers artifact that covers the same work, so the two
// sides of one piece of work can sit on one board card. Pure: ids and topics in, pairing out.

/** One artifact on either side of the pairing: an OpenSpec change or a Superpowers file. */
export type CorrelationInput = { id: string; topic: string }

/** One OpenSpec change and the Superpowers artifact that describes the same work. */
export type CorrelationMatch = { openspecId: string; superpowersId: string; confidence: number }

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/
const DESIGN_SUFFIX = '-design'
/** Below this the two topics are different work, not the same work spelled differently. */
const SIMILARITY_FLOOR = 0.6

/** A candidate pairing: one change, one artifact, and how sure the pair is. */
type Edge = {
  changeId: string
  artifactId: string
  exact: boolean
  weight: number
}

/** A pairing the matching settled on. */
type Pairing = { changeId: string; confidence: number }

/**
 * The topic a file name carries: no date prefix, no `-design` suffix, no extension, lower case
 * kebab. `2026-11-17-next-edit-suggestion-design.md` and `next-edit-suggestion` name one work.
 *
 * The letters of every script are kept: a change named in Chinese names work just as well, and a
 * topic that is empty names nothing at all. The topic never reaches a command ungated — the gate
 * in `command-values.ts` judges it before it does.
 */
export function normalizeTopic(fileName: string): string {
  const lowered = fileName.toLowerCase()
  const withoutExtension = lowered.replace(/\.md$/, '')
  const withoutDate = withoutExtension.replace(DATE_PREFIX, '')
  const withoutDesign = withoutDate.endsWith(DESIGN_SUFFIX)
    ? withoutDate.slice(0, -DESIGN_SUFFIX.length)
    : withoutDate
  return withoutDesign.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
}

/** The words a topic is made of. */
function tokens(topic: string): Set<string> {
  return new Set(
    normalizeTopic(topic)
      .split('-')
      .filter((token) => token.length > 0)
  )
}

/**
 * How much two topics overlap: the Jaccard index over their kebab tokens. Topics that share no
 * word score 0, even when one of them is a prefix of the other.
 */
export function topicSimilarity(a: string, b: string): number {
  const left = tokens(a)
  const right = tokens(b)
  if (left.size === 0 || right.size === 0) {
    return 0
  }
  let shared = 0
  for (const token of left) {
    if (right.has(token)) {
      shared += 1
    }
  }
  const union = left.size + right.size - shared
  return shared / union
}

/** Orders ids the same way every run, without asking a locale about it. */
function byId(a: string, b: string): number {
  if (a < b) {
    return -1
  }
  if (a > b) {
    return 1
  }
  return 0
}

/** The more confident pair first; an exact topic beats a merely similar one. */
function byConfidence(a: Edge, b: Edge): number {
  if (a.exact !== b.exact) {
    return a.exact ? -1 : 1
  }
  if (a.weight !== b.weight) {
    return b.weight - a.weight
  }
  return byId(a.artifactId, b.artifactId) || byId(a.changeId, b.changeId)
}

/**
 * The candidate edges between the two sides. Two empty topics are not the same topic: a name
 * that carries no topic at all pairs with nothing.
 */
function candidateEdges(
  openspec: readonly CorrelationInput[],
  superpowers: readonly CorrelationInput[]
): Edge[] {
  const edges: Edge[] = []
  for (const artifact of superpowers) {
    for (const change of openspec) {
      const changeTopic = normalizeTopic(change.topic)
      const artifactTopic = normalizeTopic(artifact.topic)
      const exact = changeTopic !== '' && changeTopic === artifactTopic
      const weight = exact ? 1 : topicSimilarity(changeTopic, artifactTopic)
      if (!exact && weight < SIMILARITY_FLOOR) {
        continue
      }
      edges.push({ changeId: change.id, artifactId: artifact.id, exact, weight })
    }
  }
  return edges
}

/**
 * Pairs the two sides with as many pairs as the candidate edges allow: Kuhn's augmenting-path
 * algorithm, which finds a maximum-cardinality matching. A greedy walk would strand an artifact
 * that could have been paired, and a stranded artifact is reported as a gap — a false warning
 * about work the user did. The edges are visited from the most confident down, so among
 * matchings of the same size the confident pairs win.
 */
function matchByMaximumCardinality(edges: readonly Edge[]): Map<string, Pairing> {
  const byArtifact = new Map<string, Edge[]>()
  for (const edge of edges) {
    const list = byArtifact.get(edge.artifactId)
    if (list) {
      list.push(edge)
    } else {
      byArtifact.set(edge.artifactId, [edge])
    }
  }
  for (const list of byArtifact.values()) {
    list.sort(byConfidence)
  }

  // The artifacts go first with their most confident edge, so the confident pairs are placed
  // before the doubtful ones.
  const artifacts = [...byArtifact.keys()].sort((a, b) => {
    const left = byArtifact.get(a)?.[0]
    const right = byArtifact.get(b)?.[0]
    if (!left || !right) {
      return byId(a, b)
    }
    return byConfidence(left, right) || byId(a, b)
  })

  const partner = new Map<string, Pairing>()
  const holder = new Map<string, string>()
  const visited = new Set<string>()

  const augment = (artifact: string): boolean => {
    if (visited.has(artifact)) {
      return false
    }
    visited.add(artifact)
    for (const edge of byArtifact.get(artifact) ?? []) {
      const current = holder.get(edge.changeId)
      if (current === undefined || augment(current)) {
        holder.set(edge.changeId, artifact)
        partner.set(artifact, { changeId: edge.changeId, confidence: edge.weight })
        return true
      }
    }
    return false
  }

  for (const artifact of artifacts) {
    visited.clear()
    augment(artifact)
  }
  return partner
}

/**
 * Pairs the two sides one to one: as many pairs as the topics allow, and neither side used
 * twice, so one plan can never satisfy two changes.
 */
export function correlate(
  openspec: readonly CorrelationInput[],
  superpowers: readonly CorrelationInput[]
): {
  matches: CorrelationMatch[]
  unmatchedOpenspec: string[]
  unmatchedSuperpowers: string[]
} {
  const pairing = matchByMaximumCardinality(candidateEdges(openspec, superpowers))

  const matches: CorrelationMatch[] = []
  const usedChanges = new Set<string>()
  for (const artifact of superpowers) {
    const matched = pairing.get(artifact.id)
    if (!matched) {
      continue
    }
    usedChanges.add(matched.changeId)
    matches.push({
      openspecId: matched.changeId,
      superpowersId: artifact.id,
      confidence: matched.confidence
    })
  }

  return {
    matches,
    unmatchedOpenspec: openspec.filter((change) => !usedChanges.has(change.id)).map((c) => c.id),
    unmatchedSuperpowers: superpowers
      .filter((artifact) => !pairing.has(artifact.id))
      .map((artifact) => artifact.id)
  }
}
