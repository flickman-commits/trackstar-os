/**
 * An Artelo order with several prints goes to production as one: each
 * print's design is attached as it is approved, and the order is sent when
 * the last one is. Holding or rejecting a print changes only our row; its
 * design stays attached at Artelo (nothing here detaches it). So before the
 * order is sent, every other print on it must be in a state where what is
 * attached is what should print. Pure: the caller loads the jobs.
 *
 *   others  the order's other prints: [{ label, jobs }] with each print's
 *           render jobs newest first (another-size renders already left out)
 *
 * Returns null when the order may go, or a sentence saying which print holds it.
 */
export function siblingBlock(others) {
  for (const { label, jobs } of others || []) {
    const current = (jobs || []).find(j => j.status === 'done' && j.review === 'approved') || null
    const attached = (jobs || []).filter(j => j.arteloAttachedAt && !j.arteloSentAt)
    // A design attached at Artelo that is not this print's approved design any
    // more (rejected, closed), unless the approved one has since been attached
    // to the same item, which replaced it there.
    const replacedAtArtelo = j => current?.arteloAttachedAt && current.arteloItemId && current.arteloItemId === j.arteloItemId
    const outdated = attached.find(j => j.id !== current?.id && !replacedAtArtelo(j))
    if (outdated) return `${label} has a design attached at Artelo that is no longer its approved design (${outdated.review}). Replace it on the Artelo order before this order is sent.`
    if (current?.sendHeldAt && current.arteloAttachedAt) return `${label} is held${current.sendHeldBy ? ` (${current.sendHeldBy})` : ''}, and its design is already attached at Artelo. Nothing on this order is sent until it is released with Send now.`
  }
  return null
}
