import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProgram } from '../src/gcode.js'
import { pickEndpoint, pickMove } from '../src/plot.js'

const xy = ([x, y]) => [x * 10, y * 10]
const allMoves = { rapid: true, cut: true }

test('selects an interior point on the arc and ignores hidden strokes', () => {
  const { moves } = parseProgram('G0 X10.\nG3 X20. Y10. R10. F600')
  const arc = moves[1].points
  const position = xy(arc[Math.floor(arc.length / 2)])
  assert.equal(pickMove(moves, xy, allMoves, position), 1)
  assert.equal(pickMove(moves, xy, { rapid: true, cut: false }, position), null)
  assert.equal(pickMove(moves, xy, allMoves, [-50, -50]), null)
})

test('keeps the inspected move at a joint shared by two moves', () => {
  const { moves } = parseProgram('G0 X10.\nG3 X20. Y10. R10. F600')
  const joint = [100, 0]
  assert.equal(pickMove(moves, xy, allMoves, joint, 1), 1)
  assert.equal(pickMove(moves, xy, allMoves, joint, 0), 0)
  assert.equal(pickEndpoint(moves[1].points, xy, joint, 'end'), 'start')
  assert.equal(pickEndpoint(moves[1].points, xy, [200, 100], 'start'), 'end')
  assert.equal(pickEndpoint(moves[1].points, xy, [-50, -50], 'start'), null)
  assert.equal(pickEndpoint([[10, 0, 0], [10, 0, -1]], xy, joint, 'end'), 'end')
})
