import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import { hasLineJumps, parseProgram, renumberProgram, scanLine, simulationEndpoint, simulationFrame } from '../src/gcode.js'

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≠ ${expected}`)
}

test('tokenizes compact CNC blocks and leaves comments intact', () => {
  const tokens = scanLine('/2N10G01X-2.5Y+.750 (A (B)) ; C')
  assert.deepEqual(tokens.map((token) => [token.kind, token.letter, token.value]), [
    ['optional', undefined, undefined],
    ['word', 'N', 10],
    ['word', 'G', 1],
    ['word', 'X', -2.5],
    ['word', 'Y', 0.75],
    ['comment', undefined, undefined],
    ['comment', undefined, undefined],
  ])
})

test('retains modal motion, coordinates and feed across blocks and converts inch values', () => {
  const model = parseProgram('G21 G90\nG00 Z4\nG01 X10 F300\nY8\nG20 G91 X1 Z-.5 F10')
  assert.deepEqual(model.issues, [])
  assert.deepEqual(model.moves.map((move) => move.rapid), [true, false, false, false])
  assert.deepEqual(model.moves[2].points.at(-1), [10, 8, 4])
  const last = model.moves.at(-1)
  assert.deepEqual(last.points.at(-1), [35.4, 8, -8.7])
  near(last.feed, 254)
})

test('interpolates center-offset helical arcs in all three active planes', () => {
  const cases = [
    ['G17\nG00 X10\nG03 X0 Y10 Z5 I-10 J0 F120', [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10, 2.5]],
    ['G18\nG00 Z10\nG03 Z0 X10 Y5 K-10 I0 F120', [Math.SQRT1_2 * 10, 2.5, Math.SQRT1_2 * 10]],
    ['G19\nG00 Y10\nG03 Y0 Z10 X5 J-10 K0 F120', [2.5, Math.SQRT1_2 * 10, Math.SQRT1_2 * 10]],
  ]
  for (const [text, midpoint] of cases) {
    const model = parseProgram(text)
    assert.deepEqual(model.issues, [])
    const move = model.moves[1]
    const frame = simulationFrame(model, move.startTime + move.duration / 2)
    frame.position.forEach((coordinate, axis) => near(coordinate, midpoint[axis]))
    near(model.cutDistance, Math.hypot(5, Math.PI * 5))
  }
})

test('supports full circle and absolute arc centers', () => {
  const model = parseProgram('G0 X10\nG90.1 G2 I0 J0 F120')
  assert.deepEqual(model.issues, [])
  near(model.cutDistance, 20 * Math.PI)
  const arc = model.moves[1]
  const sample = simulationFrame(model, arc.startTime + arc.duration / 4)
  near(sample.position[0], 0)
  near(sample.position[1], -10)
  assert.deepEqual(simulationFrame(model, model.duration).position, [10, 0, 0])
})

test('a signed radius selects the short or long circular sweep', () => {
  const minor = parseProgram('G1 X10 F300\nG2 X0 Y10 R10')
  const major = parseProgram('G1 X10 F300\nG2 X0 Y10 R-10')
  assert.deepEqual(minor.issues, [])
  assert.deepEqual(major.issues, [])
  near(minor.cutDistance - 10, 5 * Math.PI)
  near(major.cutDistance - 10, 15 * Math.PI)
})

test('selects exact arc endpoints and retains the frame on the shared timeline boundary', () => {
  const model = parseProgram('G0 X10.\nG3 X20. Y10. R10. F600\nG1 X22.')
  assert.deepEqual(model.issues, [])
  const start = simulationEndpoint(model, 1, 'start')
  const end = simulationEndpoint(model, 1, 'end')
  assert.deepEqual(start.position, [10, 0, 0])
  assert.deepEqual(end.position, [20, 10, 0])
  assert.equal(start.progress, 0)
  assert.equal(end.progress, 1)
  assert.equal(start.move.line, 2)
  assert.equal(end.move.line, 2)
  assert.equal(start.time, model.moves[1].startTime)
  assert.equal(end.time, model.moves[2].startTime)
  assert.equal(simulationFrame(model, end.time).move.line, 3)
})

test('distinguishes the two timeline positions of a closed arc', () => {
  const model = parseProgram('G0 X10.\nG3 I-10. J0. F600')
  const start = simulationEndpoint(model, 1, 'start')
  const end = simulationEndpoint(model, 1, 'end')
  assert.deepEqual(start.position, end.position)
  assert.ok(start.time < end.time)
  assert.equal(end.time, model.duration)
  assert.equal(simulationEndpoint(model, 2, 'end'), null)
})

test('reports malformed blocks with addresses and resumes after errors', () => {
  const model = parseProgram(
    'G00 X10\nG1 X12 X15\nG2 X0 Y12 R1\nG90 G91 X10\n(unfinished\nG0 X20',
  )
  assert.deepEqual(model.issues.map(({ line, severity }) => [line, severity]), [
    [2, 'error'], [3, 'error'], [4, 'error'], [5, 'error'],
  ])
  assert.equal(model.issues[0].column, 8)
  assert.deepEqual(model.moves.map(({ line }) => line), [1, 6])
  assert.deepEqual(model.moves[1].points, [[10, 0, 0], [20, 0, 0]])
})

test('suppresses unmodeled cycles and skips moves following program end', () => {
  const model = parseProgram('G0 Z5\nG81 X5 Y5 Z-8 R2\nX10\nG80\nX20\nG0 X30\nM30\nG0 X32')
  assert.deepEqual(model.issues.map(({ line, severity }) => [line, severity]), [[2, 'warning']])
  assert.deepEqual(model.moves.map(({ line }) => line), [1, 6])
})

test('the bundled example has valid motion, bounds and a playable timeline', async () => {
  const model = parseProgram(await readFile(new URL('../examples/mounting_plate.nc', import.meta.url), 'utf8'))
  assert.deepEqual(model.issues, [])
  assert.equal(model.moves.length, 91)
  assert.deepEqual(model.cutBounds, { min: [0, 0, -6], max: [80, 60, 8] })
  assert.deepEqual(simulationFrame(model, model.duration + 1).position, [0, 0, 8])
})

test('renumbering preserves headers, comments, optional blocks and spacing', () => {
  const text = '%\nO123\n(Setup)\n  /2 N001G90 \n(Plunge) G1 Z-2\n; Exit\nM30\n%'
  assert.equal(renumberProgram(text, 100, 20),
    '%\nO123\n(Setup)\n  /2 N100 G90 \n(Plunge) N120 G1 Z-2\n; Exit\nN140 M30\n%')
  assert.equal(renumberProgram(text, 0, 0, true),
    '%\nO123\n(Setup)\n  /2 G90 \n(Plunge) G1 Z-2\n; Exit\nM30\n%')
  assert.equal(renumberProgram('G90\nG0', 999999, 1), null)
})

test('guards against renumbering program flow jumps, including compact syntax', () => {
  assert.equal(hasLineJumps('N010 M97P40\nN040 G1 X10'), true)
  assert.equal(hasLineJumps('N10 (a; b) GOTO 20'), true)
  assert.equal(hasLineJumps('N10GOTO30'), true)
  assert.equal(hasLineJumps('(M97 P40)\nG1 X10 ; GOTO 30'), false)
})
