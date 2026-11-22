import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeProgram, encodeProgram } from '../src/files.js'
import { comparePrograms } from '../src/comparison.js'

test('opens UTF-8 with BOM, normalizes CRLF internally and preserves it on save', () => {
  const bytes = Uint8Array.from(Buffer.from('\uFEFF(Резание)\r\nG90\r\n', 'utf8'))
  const opening = decodeProgram(bytes)
  assert.deepEqual(opening, { text: '(Резание)\nG90\n', encoding: 'UTF-8', lineEnding: 'CRLF', bom: true })
  assert.deepEqual(encodeProgram(opening.text, opening), bytes)
})

test('Windows-1251 Russian text survives a round trip and detects unsupported characters', () => {
  const bytes = Uint8Array.of(40, 0xd2, 0xe5, 0xf1, 0xf2, 41, 13, 10)
  const opening = decodeProgram(bytes)
  assert.deepEqual(opening, { text: '(Тест)\n', encoding: 'Windows-1251', lineEnding: 'CRLF', bom: false })
  assert.deepEqual(encodeProgram(opening.text, opening), bytes)
  assert.throws(() => encodeProgram('🙂', opening), /за пределами|вне Windows-1251/)
})

test('refuses binary input and malformed data following a UTF-8 BOM', () => {
  assert.throws(() => decodeProgram(Uint8Array.of(71, 0, 48, 0)), /двоичные/)
  assert.throws(() => decodeProgram(Uint8Array.of(0xef, 0xbb, 0xbf, 0xe8)), /повреждена/)
})

test('aligns side-by-side changes and preserves source and destination line numbers', () => {
  const result = comparePrograms('G90\nG0 X10\nM30', 'G90\nG0 X20\nG1 Z-1\nM30')
  assert.equal(result.removedCount, 1)
  assert.equal(result.addedCount, 2)
  assert.deepEqual(result.rows.map((row) => [row.left?.line, row.right?.line, row.changed]), [
    [1, 1, false], [2, 2, true], [undefined, 3, true], [3, 4, false],
  ])
  assert.equal(comparePrograms('G0\n'.repeat(16000), 'G0'), null)
})
