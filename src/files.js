export const MAX_FILE_SIZE = 4 * 1024 * 1024
export const FILE_ACCEPT = '.nc,.cnc,.tap,.gcode,.ngc,.ncc,.iso,.mpf,.spf,.txt'

const utf8 = new TextDecoder('utf-8', { fatal: true })
const windows1251 = new TextDecoder('windows-1251')

export function decodeProgram(bytes) {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  if (bytes.includes(0)) throw new Error('Файл содержит двоичные данные или использует UTF-16.')
  let text
  let encoding = 'UTF-8'
  try {
    text = utf8.decode(bytes)
  } catch {
    if (bom) throw new Error('В файле повреждена последовательность UTF-8.')
    text = windows1251.decode(bytes)
    encoding = 'Windows-1251'
  }
  const lineEnding = text.includes('\r\n') ? 'CRLF' : text.includes('\r') ? 'CR' : 'LF'
  return { text: text.replace(/\r\n?/g, '\n'), encoding, lineEnding, bom }
}

export function encodeProgram(text, { encoding, lineEnding, bom }) {
  const output = lineEnding === 'CRLF' ? text.replaceAll('\n', '\r\n')
    : lineEnding === 'CR' ? text.replaceAll('\n', '\r') : text
  if (encoding !== 'Windows-1251') return new TextEncoder().encode(bom ? '\uFEFF' + output : output)
  const alphabet = new Map(Array.from({ length: 256 }, (_, byte) => (
    [windows1251.decode(Uint8Array.of(byte)), byte]
  )))
  const bytes = new Uint8Array(output.length)
  for (let i = 0; i < output.length; i += 1) {
    const byte = alphabet.get(output[i])
    if (byte === undefined) {
      throw new Error('В программе есть символы вне Windows-1251. Выберите кодировку UTF-8 в нижней строке.')
    }
    bytes[i] = byte
  }
  return bytes
}

export async function readBrowserProgram(file) {
  if (file.size > MAX_FILE_SIZE) throw new Error(`«${file.name}» превышает 4 МиБ.`)
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
}

export async function saveProgram(document, saveAs, occupiedIds) {
  const bytes = encodeProgram(document.text, document)
  if (bytes.length > MAX_FILE_SIZE) throw new Error('Размер программы превышает 4 МиБ.')
  const name = document.name.includes('.') ? document.name : document.name + '.nc'
  if (window.kontur) {
    return window.kontur.saveProgram({ name, fileId: saveAs ? null : document.fileId, bytes, occupiedIds })
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
  const link = window.document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { name }
}
