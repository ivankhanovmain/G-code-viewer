export const DEFAULT_CAMERA = { yaw: 0.58, pitch: 0.60, zoom: 1, x: 0, y: 0 }
export const ENDPOINT_COLORS = { start: '#9ee0ca', end: '#ffaf80' }

const PLAN_VIEWS = {
  XY: { right: [1, 0, 0], down: [0, -1, 0], normal: [0, 0, 1] },
  XZ: { right: [1, 0, 0], down: [0, 0, -1], normal: [0, -1, 0] },
  YZ: { right: [0, 1, 0], down: [0, 0, -1], normal: [1, 0, 0] },
}
const AXIS_COLORS = ['#ef8b74', '#8bc5a5', '#8ab9e4']

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function basis(view, camera) {
  if (view !== '3D') return PLAN_VIEWS[view]
  const x = Math.cos(camera.yaw)
  const y = Math.sin(camera.yaw)
  const sin = Math.sin(camera.pitch)
  const cos = Math.cos(camera.pitch)
  return {
    right: [x, -y, 0],
    down: [-y * sin, -x * sin, -cos],
    normal: [-y * cos, -x * cos, sin],
  }
}

function corners({ min, max }) {
  return [min[0], max[0]].flatMap((x) => (
    [min[1], max[1]].flatMap((y) => [min[2], max[2]].map((z) => [x, y, z]))
  ))
}

export function projection(view, camera, bounds, width, height) {
  const orientation = basis(view, camera)
  const { right, down } = orientation
  const points = corners(bounds)
  const xs = points.map((point) => dot(point, right))
  const ys = points.map((point) => dot(point, down))
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const maxSpan = Math.max(...bounds.max.map((value, i) => value - bounds.min[i]), 1)
  const scale = camera.zoom * Math.min(
    width * 0.75 / Math.max(maxX - minX, maxSpan * 0.14),
    height * 0.72 / Math.max(maxY - minY, maxSpan * 0.14),
  )
  const x = width / 2 + camera.x - scale * (minX + maxX) / 2
  const y = height * 0.51 + camera.y - scale * (minY + maxY) / 2
  return {
    ...orientation,
    point: (p) => [x + scale * dot(p, right), y + scale * dot(p, down)],
  }
}

export function prepareCanvas(canvas, width, height) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const pixelWidth = Math.round(width * dpr)
  const pixelHeight = Math.round(height * dpr)
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth
    canvas.height = pixelHeight
  }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  return ctx
}

function gridInterval(span) {
  const approximate = span / 9
  const power = 10 ** Math.floor(Math.log10(approximate))
  return ([1, 2, 5, 10].find((step) => power * step >= approximate) ?? 10) * power
}

function stroke(ctx, points, color, width = 1) {
  ctx.beginPath()
  ctx.moveTo(...points[0])
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(...points[i])
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.stroke()
}

function segmentDistanceSquared(x, y, from, to) {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const lengthSquared = dx * dx + dy * dy
  const along = lengthSquared ? ((x - from[0]) * dx + (y - from[1]) * dy) / lengthSquared : 0
  const fraction = Math.max(0, Math.min(1, along))
  return (x - from[0] - fraction * dx) ** 2 + (y - from[1] - fraction * dy) ** 2
}

export function pickMove(moves, project, visible, [x, y], preferredIndex) {
  let nearest = null
  let best = 8 ** 2
  for (const [index, { rapid, points }] of moves.entries()) {
    if (!visible[rapid ? 'rapid' : 'cut']) continue
    let from = project(points[0])
    for (let i = 1; i < points.length; i += 1) {
      const to = project(points[i])
      const distance = segmentDistanceSquared(x, y, from, to)
      if (distance < best || (distance === best && (nearest === null || index === preferredIndex))) {
        nearest = index
        best = distance
      }
      from = to
    }
  }
  return nearest
}

export function pickEndpoint(points, project, [x, y], currentEndpoint = 'start') {
  const distance = (point) => {
    const [px, py] = project(point)
    return Math.hypot(px - x, py - y)
  }
  const start = distance(points[0])
  const end = distance(points.at(-1))
  if (Math.min(start, end) > 11) return null
  if (start === end) return currentEndpoint
  return start < end ? 'start' : 'end'
}

function polygon(ctx, points, fill, edge) {
  ctx.beginPath()
  ctx.moveTo(...points[0])
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(...points[i])
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  if (edge) {
    ctx.strokeStyle = edge
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

function drawGrid(ctx, project, bounds, view) {
  const span = Math.max(...bounds.max.map((value, i) => value - bounds.min[i]), 1)
  const step = gridInterval(span)
  const axes = view === 'XZ' ? [0, 2, 1] : view === 'YZ' ? [1, 2, 0] : [0, 1, 2]
  const [u, v, w] = axes
  const plane = view === '3D' ? bounds.min[w] - step * 0.24 : bounds.min[w]
  const extent = (index) => {
    const pad = Math.max(step * 2, (span - (bounds.max[index] - bounds.min[index])) / 2)
    return [Math.floor((bounds.min[index] - pad) / step), Math.ceil((bounds.max[index] + pad) / step)]
  }
  const [u0, u1] = extent(u)
  const [v0, v1] = extent(v)
  const gridPoint = (a, b) => {
    const position = []
    position[u] = a * step
    position[v] = b * step
    position[w] = plane
    return project(position)
  }
  for (let a = u0; a <= u1; a += 1) {
    const color = a === 0 ? '#63807880' : a % 2 === 0 ? '#53687072' : '#495c645b'
    stroke(ctx, [gridPoint(a, v0), gridPoint(a, v1)], color)
  }
  for (let b = v0; b <= v1; b += 1) {
    const color = b === 0 ? '#94645a64' : b % 2 === 0 ? '#53687072' : '#495c645b'
    stroke(ctx, [gridPoint(u0, b), gridPoint(u1, b)], color)
  }
}

function drawEnvelope(ctx, { point, normal }, bounds) {
  const [x0, y0, z0] = bounds.min
  const [x1, y1] = bounds.max
  const z1 = z0 < 0 && bounds.max[2] >= 0 ? 0 : bounds.max[2]
  const flat = (z) => [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]]
  const top = flat(z1).map(point)
  const bottom = flat(z0).map(point)

  if (z1 !== z0) {
    const faces = [
      normal[1] < 0 ? [0, 1] : [2, 3],
      normal[0] < 0 ? [3, 0] : [1, 2],
    ]
    for (const [a, b] of faces) {
      polygon(ctx, [top[a], top[b], bottom[b], bottom[a]], '#2b3a4188', '#50646c80')
    }
  }
  polygon(ctx, top, '#35444955', '#65767c87')
}

function traceMoves(ctx, model, project, visible) {
  const cuts = Array.from({ length: 4 }, () => new Path2D())
  const rapid = new Path2D()
  const bounds = model.cutBounds ?? model.bounds
  const span = Math.max(bounds.max[2] - bounds.min[2], 1)
  for (const move of model.moves) {
    const end = move.points.at(-1)
    const level = Math.min(3, Math.floor(4 * (end[2] - bounds.min[2]) / span))
    const path = move.rapid ? rapid : cuts[level]
    path.moveTo(...project(move.points[0]))
    for (let i = 1; i < move.points.length; i += 1) path.lineTo(...project(move.points[i]))
  }
  if (visible.rapid) {
    ctx.setLineDash([5, 5])
    ctx.strokeStyle = '#77a7baad'
    ctx.lineWidth = 1.25
    ctx.stroke(rapid)
    ctx.setLineDash([])
  }
  if (visible.cut) {
    const colors = ['#c56342', '#e47848', '#f19863', '#ffc08c']
    cuts.forEach((path, level) => {
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.strokeStyle = '#ee784938'
      ctx.lineWidth = 6.5
      ctx.stroke(path)
      ctx.strokeStyle = colors[level]
      ctx.lineWidth = 1.8
      ctx.stroke(path)
    })
  }
}

function drawTriad(ctx, { right, down }, height) {
  const center = [44, height - 43]
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  ctx.font = '600 10px "IBM Plex Mono", monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  axes.forEach((axis, index) => {
    const x = dot(axis, right)
    const y = dot(axis, down)
    if (Math.hypot(x, y) < 0.1) return
    const color = AXIS_COLORS[index]
    const tip = [center[0] + 25 * x, center[1] + 25 * y]
    stroke(ctx, [center, tip], color, 1.5)
    ctx.fillStyle = color
    ctx.fillText('XYZ'[index], center[0] + 35 * x, center[1] + 35 * y)
    ctx.beginPath()
    ctx.arc(...tip, 2, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.fillStyle = '#afbec0'
  ctx.beginPath()
  ctx.arc(...center, 2.4, 0, Math.PI * 2)
  ctx.fill()
}

function drawCube(ctx, { right, down, normal }, width) {
  const center = [width - 48, 56]
  const project = (p) => [center[0] + 16 * dot(p, right), center[1] + 16 * dot(p, down)]
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '600 11px "IBM Plex Mono", monospace'
  normal.forEach((n, axis) => {
    if (Math.abs(n) < 0.05) return
    const k = Math.sign(n)
    const facePoint = (u, v) => {
      const p = [u, v, k]
      if (axis === 0) return [k, u, v]
      if (axis === 1) return [u, k, v]
      return p
    }
    polygon(ctx, [facePoint(-1, -1), facePoint(1, -1), facePoint(1, 1), facePoint(-1, 1)].map(project),
      ['#273337', '#233034', '#303f43'][axis], '#60757d')
    ctx.fillStyle = ['#e69883', '#9dc9ae', '#c0cdd0'][axis]
    ctx.fillText('XYZ'[axis], ...project(facePoint(0, 0)))
  })
}

export function renderScene(canvas, width, height, model, view, camera, visible) {
  const ctx = prepareCanvas(canvas, width, height)
  const bounds = model.cutBounds ?? model.bounds
  const orientation = projection(view, camera, bounds ?? { min: [-40, -25, -5], max: [40, 25, 0] }, width, height)
  if (visible.grid) drawGrid(ctx, orientation.point, bounds ?? { min: [-40, -25, -5], max: [40, 25, 0] }, view)
  if (bounds) {
    if (view === '3D' && model.cutBounds) drawEnvelope(ctx, orientation, bounds)
    traceMoves(ctx, model, orientation.point, visible)
  }
  drawTriad(ctx, orientation, height)
  drawCube(ctx, orientation, width)
  return orientation
}

function drawEndpoint(ctx, [x, y], endpoint, selected) {
  const color = ENDPOINT_COLORS[endpoint]
  if (selected) {
    ctx.beginPath()
    ctx.arc(x, y, 10, 0, Math.PI * 2)
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
  if (endpoint === 'end') {
    polygon(ctx, [[x, y - 6], [x + 6, y], [x, y + 6], [x - 6, y]], color, '#243135')
  } else {
    ctx.beginPath()
    ctx.arc(x, y, 5, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = '#243135'
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

export function renderMarker(canvas, width, height, orientation, frame, endpoint) {
  const ctx = prepareCanvas(canvas, width, height)
  if (!frame || !orientation) return
  const { points, rapid } = frame.move
  const { point } = orientation
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (endpoint) {
    const path = points.map(point)
    stroke(ctx, path, '#1b2427', 5)
    stroke(ctx, path, rapid ? '#a8dbea' : '#ffcfad', 2.5)
    const inactive = endpoint === 'start' ? 'end' : 'start'
    drawEndpoint(ctx, inactive === 'start' ? path[0] : path.at(-1), inactive, false)
    drawEndpoint(ctx, endpoint === 'start' ? path[0] : path.at(-1), endpoint, true)
    return
  }
  const index = Math.floor(frame.progress * (points.length - 1))
  const leading = [...points.slice(0, index + 1), frame.position].map(point)
  stroke(ctx, leading, rapid ? '#a8dbea' : '#ffcfad', 3)
  const [x, y] = point(frame.position)
  ctx.fillStyle = '#ff9b6240'
  ctx.beginPath()
  ctx.arc(x, y, 10, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffb584'
  ctx.strokeStyle = '#ffe2cd'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(x, y, 4.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}
