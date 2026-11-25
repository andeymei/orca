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

/**
 * The topic a file name carries: no date prefix, no `-design` suffix, no extension, lower case
 * kebab. `2026-11-17-next-edit-suggestion-design.md` and `next-edit-suggestion` name one work.
 */
export function normalizeTopic(fileName: string): string {
  const lowered = fileName.toLowerCase()
  const withoutExtension = lowered.replace(/\.md$/, '')
  const withoutDate = withoutExtension.replace(DATE_PREFIX, '')
  const withoutDesign = withoutDate.endsWith(DESIGN_SUFFIX)
    ? withoutDate.slice(0, -DESIGN_SUFFIX.length)
    : withoutDate
  return withoutDesign.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
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

/** One candidate pairing, with the score the ranking uses. */
type Candidate = {
  openspecId: string
  superpowersId: string
  exact: boolean
  similarity: number
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

/**
 * Pairs the two sides one to one: the best pairing wins, and neither side is used twice, so one
 * plan can never satisfy two changes.
 */
export function correlate(
  openspec: readonly CorrelationInput[],
  superpowers: readonly CorrelationInput[]
): {
  matches: CorrelationMatch[]
  unmatchedOpenspec: string[]
  unmatchedSuperpowers: string[]
} {
  const candidates: Candidate[] = []
  for (const artifact of superpowers) {
    for (const change of openspec) {
      const changeTopic = normalizeTopic(change.topic)
      const artifactTopic = normalizeTopic(artifact.topic)
      const exact = changeTopic === artifactTopic
      candidates.push({
        openspecId: change.id,
        superpowersId: artifact.id,
        exact,
        similarity: exact ? 1 : topicSimilarity(changeTopic, artifactTopic)
      })
    }
  }

  // An exact topic beats a merely similar one, a better overlap beats a worse one, and the ids
  // break a tie, so the same input always pairs the same way.
  candidates.sort((a, b) => {
    if (a.exact !== b.exact) {
      return a.exact ? -1 : 1
    }
    return (
      b.similarity - a.similarity ||
      byId(a.superpowersId, b.superpowersId) ||
      byId(a.openspecId, b.openspecId)
    )
  })

  const matches: CorrelationMatch[] = []
  const usedOpenspec = new Set<string>()
  const usedSuperpowers = new Set<string>()
  for (const candidate of candidates) {
    if (candidate.similarity < SIMILARITY_FLOOR) {
      continue
    }
    if (usedOpenspec.has(candidate.openspecId) || usedSuperpowers.has(candidate.superpowersId)) {
      continue
    }
    usedOpenspec.add(candidate.openspecId)
    usedSuperpowers.add(candidate.superpowersId)
    matches.push({
      openspecId: candidate.openspecId,
      superpowersId: candidate.superpowersId,
      confidence: candidate.exact ? 1 : candidate.similarity
    })
  }

  return {
    matches,
    unmatchedOpenspec: openspec
      .filter((change) => !usedOpenspec.has(change.id))
      .map((change) => change.id),
    unmatchedSuperpowers: superpowers
      .filter((artifact) => !usedSuperpowers.has(artifact.id))
      .map((artifact) => artifact.id)
  }
}
