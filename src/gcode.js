const WORD = /([A-Z])[ \t]*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/iy
const AXES = 'XYZ'
const OFFSETS = 'IJK'
const PLANES = { 17: [0, 1, 2], 18: [2, 0, 1], 19: [1, 2, 0] }
const TURN = Math.PI * 2
const EPSILON = 1e-7
const MAX_LINES = 60_000
const MAX_POINTS = 250_000
const RAPID_FEED = 3600
const DEFAULT_FEED = 600

export function scanLine(line) {
  const tokens = []
  let cursor = 0
  let seenCode = false
  while (cursor < line.length) {
    const start = cursor
    const char = line[cursor]
    if (/\s/.test(char)) {
      cursor += 1
      continue
    }
    if (char === ';') {
      tokens.push({ kind: 'comment', start, end: line.length })
      break
    }
    if (char === '(') {
      let depth = 1
      while (++cursor < line.length && depth > 0) {
        if (line[cursor] === ')') depth -= 1
        if (line[cursor] === '(') depth += 1
      }
      tokens.push({
        kind: depth === 0 ? 'comment' : 'invalid',
        message: 'Незакрытый комментарий.',
        start,
        end: cursor,
      })
      continue
    }
    if (char === '%' || (char === '/' && !seenCode)) {
      cursor += 1
      if (char === '/' && /[1-9]/.test(line[cursor] ?? '')) cursor += 1
      tokens.push({ kind: char === '%' ? 'delimiter' : 'optional', start, end: cursor })
      seenCode = true
      continue
    }
    WORD.lastIndex = cursor
    const match = WORD.exec(line)
    if (match) {
      cursor = WORD.lastIndex
      tokens.push({
        kind: 'word',
        letter: match[1].toUpperCase(),
        value: Number(match[2]),
        start,
        end: cursor,
      })
    } else {
      cursor += 1
      tokens.push({
        kind: 'invalid',
        message: `Ожидалось слово по шаблону G01 или X12.5. Символ «${char}».`,
        start,
        end: cursor,
      })
    }
    seenCode = true
  }
  return tokens
}

function arcSweep(startAngle, endAngle, direction) {
  const angle = direction * (endAngle - startAngle)
  return ((angle % TURN) + TURN) % TURN
}

function createArc(start, end, words, modal, direction) {
  const [u, v, w] = PLANES[modal.plane]
  const offsetU = words.get(OFFSETS[u])
  const offsetV = words.get(OFFSETS[v])
  const radiusWord = words.get('R')
  const dx = end[u] - start[u]
  const dy = end[v] - start[v]
  const chord = Math.hypot(dx, dy)
  let centerU
  let centerV
  if (words.has(OFFSETS[w])) return { error: 'Смещение центра лежит вне активной плоскости.' }
  if (radiusWord) {
    const radius = Math.abs(radiusWord.value * modal.scale)
    if (offsetU || offsetV) return { error: 'Задайте центр дуги через IJK или через R.' }
    if (chord < EPSILON || radius < chord / 2 - EPSILON) {
      return { error: 'Радиус R не образует дугу между заданными точками.' }
    }
    const rise = Math.sqrt(Math.max(0, radius ** 2 - (chord / 2) ** 2))
    const side = direction * (radiusWord.value < 0 ? -1 : 1)
    centerU = (start[u] + end[u]) / 2 - side * dy * rise / chord
    centerV = (start[v] + end[v]) / 2 + side * dx * rise / chord
  } else {
    if ((!offsetU && !offsetV) || (modal.absoluteCenter && (!offsetU || !offsetV))) {
      return { error: `Для дуги требуется R или центр в плоскости G${modal.plane}.` }
    }
    const du = (offsetU?.value ?? 0) * modal.scale
    const dv = (offsetV?.value ?? 0) * modal.scale
    centerU = modal.absoluteCenter ? du : start[u] + du
    centerV = modal.absoluteCenter ? dv : start[v] + dv
  }
  const radius = Math.hypot(start[u] - centerU, start[v] - centerV)
  const endRadius = Math.hypot(end[u] - centerU, end[v] - centerV)
  if (radius < EPSILON || Math.abs(endRadius - radius) > Math.max(0.025, radius * 0.001)) {
    return { error: 'Начало и конец дуги должны лежать на одной окружности.' }
  }
  const startAngle = Math.atan2(start[v] - centerV, start[u] - centerU)
  const endAngle = Math.atan2(end[v] - centerV, end[u] - centerU)
  const sweep = chord < EPSILON ? TURN : arcSweep(startAngle, endAngle, direction)
  const steps = Math.max(2, Math.ceil(sweep / (Math.PI / 60)))
  const points = [start]
  for (let step = 1; step < steps; step += 1) {
    const progress = step / steps
    const angle = startAngle + direction * sweep * progress
    const point = []
    point[u] = centerU + radius * Math.cos(angle)
    point[v] = centerV + radius * Math.sin(angle)
    point[w] = start[w] + (end[w] - start[w]) * progress
    points.push(point)
  }
  points.push(end)
  return { points, distance: Math.hypot(sweep * radius, end[w] - start[w]) }
}

function expandBounds(bounds, points) {
  if (!bounds) bounds = { min: [...points[0]], max: [...points[0]] }
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      bounds.min[axis] = Math.min(bounds.min[axis], point[axis])
      bounds.max[axis] = Math.max(bounds.max[axis], point[axis])
    }
  }
  return bounds
}

const MODAL_GROUPS = [
  [0, 1, 2, 3, 38.2, 38.3, 38.4, 38.5, 73, 74, 76, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89],
  [17, 18, 19],
  [20, 21],
  [90, 91],
  [90.1, 91.1],
  [93, 94, 95],
  [54, 55, 56, 57, 58, 59, 59.1, 59.2, 59.3],
]
const ACCEPTED_G = new Set([9, 15, 40, 49, 54, 61, 61.1, 64, 97, 98, 99])
const NON_GEOMETRY_M = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 19, 30, 48, 49, 60])
const PARAMETERS = new Set('NGMXYZIJKRFSTOHPDLQABCUVW'.split(''))
const OVERRIDE_AXIS = /^[ABCUVW]$/

export function parseProgram(text) {
  const lines = text.split(/\r?\n/)
  let modal = {
    scale: 1,
    plane: 17,
    absolute: true,
    absoluteCenter: false,
    motion: 0,
    feed: 0,
    feedMode: 94,
    spindle: 0,
    workOffset: 54,
  }
  let position = [0, 0, 0]
  let bounds = null
  let cutBounds = null
  let duration = 0
  let rapidDistance = 0
  let cutDistance = 0
  let pointCount = 0
  let ended = false
  let geometryLimited = false
  const moves = []
  const issues = []
  const warningKeys = new Set()
  const diagnose = (line, severity, message, column = 1) => {
    issues.push({ line, severity, message, column })
  }
  const warnOnce = (line, key, message, column) => {
    if (warningKeys.has(key)) return
    warningKeys.add(key)
    diagnose(line, 'warning', message, column)
  }

  for (let index = 0; index < Math.min(lines.length, MAX_LINES); index += 1) {
    const line = index + 1
    const tokens = scanLine(lines[index])
    const words = new Map()
    const gCodes = []
    const mCodes = []
    let invalid = false
    let skip = false

    for (const token of tokens) {
      if (token.kind === 'invalid') {
        if (!invalid) diagnose(line, 'error', token.message, token.start + 1)
        invalid = true
        continue
      }
      if (token.kind !== 'word') continue
      const { letter, value, start } = token
      if (!Number.isFinite(value) || Math.abs(value) > 1e9) {
        diagnose(line, 'error', `Значение ${letter} выходит за допустимый диапазон.`, start + 1)
        invalid = true
      } else if ('NOMT'.includes(letter) && (!Number.isInteger(value) || value < 0)) {
        diagnose(line, 'error', `Для адреса ${letter} требуется целое неотрицательное число.`, start + 1)
        invalid = true
      } else if (!PARAMETERS.has(letter)) {
        diagnose(line, 'warning', `Адрес ${letter} не поддерживается.`, start + 1)
        skip = true
      } else if (letter === 'G') {
        gCodes.push(token)
      } else if (letter === 'M') {
        mCodes.push(token)
      } else if (words.has(letter)) {
        diagnose(line, 'error', `Адрес ${letter} повторяется в кадре.`, start + 1)
        invalid = true
      } else {
        words.set(letter, token)
      }
    }
    if (tokens.some((token) => token.kind === 'delimiter') &&
        tokens.some((token) => token.kind !== 'delimiter' && token.kind !== 'comment')) {
      diagnose(line, 'error', 'Разделитель % должен располагаться в отдельной строке.')
      invalid = true
    }
    if (invalid || ended || (words.size === 0 && !gCodes.length && !mCodes.length)) continue

    const next = { ...modal }
    const groups = new Set()
    for (const { value, start } of gCodes) {
      const group = MODAL_GROUPS.findIndex((codes) => codes.includes(value))
      if (group >= 0 && groups.has(group)) {
        diagnose(line, 'error', 'В кадре несколько команд одной модальной группы.', start + 1)
        invalid = true
      }
      if (group >= 0) groups.add(group)

      if ([0, 1, 2, 3].includes(value)) next.motion = value
      else if (value === 80) next.motion = null
      else if (value === 4) skip = true
      else if ([17, 18, 19].includes(value)) next.plane = value
      else if (value === 20 || value === 21) next.scale = value === 20 ? 25.4 : 1
      else if (value === 90 || value === 91) next.absolute = value === 90
      else if (value === 90.1 || value === 91.1) next.absoluteCenter = value === 90.1
      else if (value === 94) next.feedMode = 94
      else if (value === 93 || value === 95) {
        next.feedMode = value
        warnOnce(line, `G${value}`, `Режим подачи G${value} отображается с условной скоростью.`, start + 1)
      } else if (group === 6) {
        if (value !== next.workOffset) {
          warnOnce(line, `G${value}`, `Система G${value} показана в номинальных координатах.`, start + 1)
        }
        next.workOffset = value
      } else if ([41, 42, 43, 43.1, 43.2, 44].includes(value)) {
        warnOnce(line, `G${value}`, `Компенсация G${value} не учтена в траектории.`, start + 1)
      } else if (!ACCEPTED_G.has(value)) {
        if (group === 0) next.motion = null
        warnOnce(line, `G${value}`, `Команда G${value} не поддерживается в симуляции.`, start + 1)
        skip = true
      }
    }
    for (const { value, start } of mCodes) {
      if (!NON_GEOMETRY_M.has(value)) {
        warnOnce(line, `M${value}`, `Команда M${value} не поддерживается в симуляции.`, start + 1)
        if ([97, 98, 99].includes(value)) skip = true
      }
    }

    for (const [letter, token] of words) {
      if (OVERRIDE_AXIS.test(letter)) {
        warnOnce(line, letter, `Ось ${letter} не поддерживается в симуляции.`, token.start + 1)
        skip = true
      }
      if (['F', 'S'].includes(letter) && token.value < 0) {
        diagnose(line, 'error', `Значение ${letter} должно быть неотрицательным.`, token.start + 1)
        invalid = true
      }
    }
    if (invalid) continue
    if (words.has('F')) next.feed = words.get('F').value * next.scale
    if (words.has('S')) next.spindle = words.get('S').value
    if (mCodes.some(({ value }) => value === 5)) next.spindle = 0
    ended = mCodes.some(({ value }) => value === 2 || value === 30 || value === 99)

    const hasAxis = [...AXES].some((axis) => words.has(axis))
    const isArc = next.motion === 2 || next.motion === 3
    const hasCenter = [...OFFSETS, 'R'].some((axis) => words.has(axis))
    if (skip || next.motion === null || (!hasAxis && !(isArc && hasCenter))) {
      modal = next
      continue
    }
    const end = position.map((coordinate, axis) => {
      const word = words.get(AXES[axis])
      if (!word) return coordinate
      return next.absolute ? word.value * next.scale : coordinate + word.value * next.scale
    })
    const rapid = next.motion === 0
    const geometry = isArc
      ? createArc(position, end, words, next, next.motion === 2 ? -1 : 1)
      : { points: [position, end], distance: Math.hypot(...end.map((value, axis) => value - position[axis])) }

    if (geometry.error) {
      diagnose(line, 'error', geometry.error)
      continue
    }
    modal = next
    position = end
    if (geometry.distance < EPSILON) continue
    pointCount += geometry.points.length
    if (pointCount > MAX_POINTS) {
      if (!geometryLimited) {
        diagnose(line, 'warning', 'Превышен предел точек траектории. Показано начало программы.')
        geometryLimited = true
      }
      continue
    }
    const feed = !rapid && next.feedMode === 94 ? next.feed : 0
    const seconds = Math.max(0.075, 60 * geometry.distance / (rapid ? RAPID_FEED : feed || DEFAULT_FEED))
    const move = {
      line,
      rapid,
      points: geometry.points,
      startTime: duration,
      duration: seconds,
      feed,
      spindle: next.spindle,
    }
    moves.push(move)
    duration += seconds
    bounds = expandBounds(bounds, geometry.points)
    if (rapid) rapidDistance += geometry.distance
    else {
      cutDistance += geometry.distance
      cutBounds = expandBounds(cutBounds, geometry.points)
    }
  }
  if (lines.length > MAX_LINES) {
    diagnose(MAX_LINES, 'warning', `Проверены первые ${MAX_LINES.toLocaleString('ru-RU')} строк.`)
  }
  return { moves, issues, bounds, cutBounds, duration, cutDistance, rapidDistance, lineCount: lines.length }
}

export function simulationFrame(model, time) {
  const { moves, duration } = model
  if (!moves.length) return null
  const seconds = Math.max(0, Math.min(duration, time))
  let low = 0
  let high = moves.length - 1
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2)
    if (moves[middle].startTime <= seconds) low = middle
    else high = middle - 1
  }
  const move = moves[low]
  const progress = seconds >= move.startTime + move.duration ? 1 : (seconds - move.startTime) / move.duration
  const pointIndex = progress * (move.points.length - 1)
  const index = Math.floor(pointIndex)
  const from = move.points[index]
  const to = move.points[index + 1] ?? from
  const position = from.map((coordinate, axis) => coordinate + (to[axis] - coordinate) * (pointIndex - index))
  return { index: low, move, position, progress }
}

export function hasLineJumps(text) {
  return text.split(/\r?\n/).some((line) => {
    const code = scanLine(line).filter((token) => token.kind !== 'comment')
    const stripped = code.map(({ start, end }) => line.slice(start, end)).join('')
    if (/GOTO\s*[\d#\[]/i.test(stripped)) return true
    const words = code.filter((token) => token.kind === 'word')
    return words.some(({ letter, value }) => letter === 'M' && (value === 97 || value === 99))
      && words.some(({ letter }) => letter === 'P')
  })
}

export const MAX_BLOCK_NUMBER = 999999

export function renumberProgram(text, start, step, remove = false) {
  let number = start
  let overflow = false
  const lines = text.split('\n').map((line) => {
    const tokens = scanLine(line)
    const first = tokens.find((token) => token.kind !== 'comment' && token.kind !== 'optional')
    if (!first || first.kind !== 'word' || first.letter === 'O') return line
    if (first.letter === 'N') {
      const after = line.slice(first.end).replace(/^[ \t]+/, '')
      if (remove) return line.slice(0, first.start) + after
      overflow ||= number > MAX_BLOCK_NUMBER
      const result = line.slice(0, first.start) + `N${number}` + (after ? ` ${after}` : '')
      number += step
      return result
    }
    if (remove) return line
    overflow ||= number > MAX_BLOCK_NUMBER
    const result = line.slice(0, first.start) + `N${number} ` + line.slice(first.start)
    number += step
    return result
  })
  return overflow ? null : lines.join('\n')
}
