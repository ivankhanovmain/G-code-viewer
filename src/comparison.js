import { diffArrays } from 'diff'

export function comparePrograms(left, right) {
  const first = left.split('\n')
  const second = right.split('\n')
  if (first.length + second.length > 16_000) return null
  const changes = diffArrays(first, second, { timeout: 350, maxEditLength: 8000 })
  if (!changes) return null
  const rows = []
  let leftLine = 1
  let rightLine = 1
  let removed = []
  let added = []
  let addedCount = 0
  let removedCount = 0

  function flush() {
    for (let i = 0; i < Math.max(removed.length, added.length); i += 1) {
      const hasLeft = i < removed.length
      const hasRight = i < added.length
      rows.push({
        left: hasLeft ? { line: leftLine++, text: removed[i] } : null,
        right: hasRight ? { line: rightLine++, text: added[i] } : null,
        changed: true,
      })
    }
    removed = []
    added = []
  }

  for (const change of changes) {
    if (change.removed) {
      removed.push(...change.value)
      removedCount += change.count
    } else if (change.added) {
      added.push(...change.value)
      addedCount += change.count
    } else {
      flush()
      for (const text of change.value) {
        rows.push({ left: { line: leftLine++, text }, right: { line: rightLine++, text }, changed: false })
      }
    }
  }
  flush()
  return { rows, addedCount, removedCount }
}
