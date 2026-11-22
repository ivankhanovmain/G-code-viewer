const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron')
const { constants } = require('node:fs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const MAX_FILE_SIZE = 4 * 1024 * 1024
const files = new Map()
const fileIds = new Map()
const filters = [
  { name: 'Программы ЧПУ', extensions: ['nc', 'cnc', 'tap', 'gcode', 'ngc', 'ncc', 'iso', 'mpf', 'spf', 'txt'] },
  { name: 'Все файлы', extensions: ['*'] },
]

let mainWindow
let allowClose = false

function fileKey(target) {
  return process.platform === 'win32' ? target.toLowerCase() : target
}

function registerFile(target) {
  const key = fileKey(target)
  const fileId = fileIds.get(key) ?? randomUUID()
  fileIds.set(key, fileId)
  files.set(fileId, target)
  return { fileId, name: path.basename(target) }
}

function checkSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Недопустимый источник запроса.')
  }
}

async function openProgram(target) {
  const realPath = await fs.realpath(target)
  const handle = await fs.open(realPath, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('Выберите обычный файл.')
    if (info.size > MAX_FILE_SIZE) throw new Error(`«${path.basename(target)}» превышает 4 МиБ.`)
    const bytes = await handle.readFile()
    if (bytes.length > MAX_FILE_SIZE) throw new Error('Размер файла превышает 4 МиБ.')
    return { ...registerFile(realPath), name: path.basename(target), bytes: Uint8Array.from(bytes) }
  } finally {
    await handle.close()
  }
}

async function writeProgram(target, bytes) {
  let mode
  try {
    mode = (await fs.stat(target)).mode & 0o777
    await fs.access(target, constants.W_OK)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const temporary = path.join(path.dirname(target), `.kontur-${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx', mode: mode ?? 0o666 })
    if (mode !== undefined && process.platform !== 'win32') await fs.chmod(temporary, mode)
    await fs.rename(temporary, target)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

ipcMain.handle('program:open', async (event, multiple) => {
  checkSender(event)
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Открыть программу',
    properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    filters,
  })
  if (canceled) return []
  const results = []
  for (const target of filePaths) {
    try {
      results.push(await openProgram(target))
    } catch (error) {
      results.push({ name: path.basename(target), error: error.message })
    }
  }
  return results
})

ipcMain.handle('program:save', async (event, { name, fileId, bytes, occupiedIds }) => {
  checkSender(event)
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_FILE_SIZE) {
    throw new Error('Недопустимый размер программы.')
  }
  let target = files.get(fileId)
  if (!target) {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Сохранить программу',
      defaultPath: typeof name === 'string' ? path.basename(name).slice(0, 200) : 'program.nc',
      filters,
    })
    if (canceled || !filePath) return null
    target = await fs.realpath(filePath).catch((error) => {
      if (error.code === 'ENOENT') return filePath
      throw error
    })
  }
  if (Array.isArray(occupiedIds) && occupiedIds.includes(fileIds.get(fileKey(target)))) {
    throw new Error('Этот файл уже открыт в другой вкладке. Выберите другое имя.')
  }
  await writeProgram(target, bytes)
  return registerFile(target)
})

function createWindow() {
  allowClose = false
  mainWindow = new BrowserWindow({
    title: 'Контур — редактор G-кода',
    width: 1440,
    height: 920,
    minWidth: 820,
    minHeight: 570,
    backgroundColor: '#192023',
    icon: path.join(__dirname, '../dist/kontur.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    if (!allowClose) {
      allowClose = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        title: 'Несохранённые изменения',
        message: 'Закрыть Контур без сохранения изменений?',
        buttons: ['Остаться в редакторе', 'Закрыть без сохранения'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      }) === 1
    }
    if (allowClose) event.preventDefault()
  })
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => {
    mainWindow = null
    files.clear()
    fileIds.clear()
  })
  mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
}

app.setName('Контур')
app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()
  app.on('activate', () => {
    if (!mainWindow) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
