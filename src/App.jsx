import { SearchQuery } from '@codemirror/search'
import { CircleAlert, CircleCheck, X } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import demo from '../examples/mounting_plate.nc?raw'
import { CodeEditor } from './CodeEditor.jsx'
import { CompareDialog, HelpDialog, RenumberDialog, UnsavedDialog } from './Dialogs.jsx'
import { ToolpathViewer } from './ToolpathViewer.jsx'
import { Diagnostics, Header, SearchBar, StatusBar, Tabs, Toolbar } from './WorkbenchUI.jsx'
import { FILE_ACCEPT, decodeProgram, readBrowserProgram, saveProgram } from './files.js'
import { parseProgram } from './gcode.js'

let documentCounter = 0

function newDocument({ name = 'Без имени.nc', text = '', encoding = 'UTF-8', lineEnding = 'LF', bom = false, ...rest } = {}) {
  return {
    id: ++documentCounter, name, text, encoding, lineEnding, bom,
    savedText: text, savedEncoding: encoding, savedLineEnding: lineEnding, savedBom: bom,
    ...rest,
  }
}

function demoDocument() {
  return newDocument({ name: 'mounting_plate.nc', text: demo, isDemo: true })
}

function isDirty(doc) {
  return doc.text !== doc.savedText || doc.encoding !== doc.savedEncoding ||
    doc.lineEnding !== doc.savedLineEnding || doc.bom !== doc.savedBom
}

function decodeFile({ name, bytes, fileId }) {
  return { name, fileId, ...decodeProgram(bytes) }
}

async function browserFiles(files) {
  return Promise.all(Array.from(files, async (file) => {
    try {
      return await readBrowserProgram(file)
    } catch (error) {
      return { name: file.name, error: error.message }
    }
  }))
}

function readPicker(input) {
  return new Promise((resolve) => {
    const finish = (result) => {
      input.removeEventListener('change', change)
      input.removeEventListener('cancel', cancel)
      resolve(result)
    }
    const change = async () => finish(await browserFiles(input.files))
    const cancel = () => finish([])
    input.value = ''
    input.addEventListener('change', change, { once: true })
    input.addEventListener('cancel', cancel, { once: true })
    input.click()
  })
}

export default function App() {
  const [documents, setDocuments] = useState(() => [demoDocument()])
  const [activeId, setActiveId] = useState(() => documents[0].id)
  const [searchMode, setSearchMode] = useState(null)
  const [searchText, setSearchText] = useState('')
  const [replacement, setReplacement] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(true)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [view, setView] = useState('3D')
  const [expanded, setExpanded] = useState(false)
  const [split, setSplit] = useState(42)
  const [playing, setPlaying] = useState(false)
  const [simulationLine, setSimulationLine] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const editor = useRef(null)
  const viewer = useRef(null)
  const workspace = useRef(null)
  const selectFiles = useRef(null)
  const compareFile = useRef(null)
  const buffers = useRef(new Map())
  const saveGuard = useRef(false)
  const isOpening = useRef(false)
  const keyboard = useRef(null)

  const active = documents.find((doc) => doc.id === activeId) ?? documents[0]
  const deferred = useDeferredValue(active)
  const currentText = deferred.id === active.id ? deferred.text : active.text
  const model = useMemo(() => parseProgram(currentText), [currentText])
  const query = useMemo(() => new SearchQuery({
    search: searchMode ? searchText : '',
    replace: replacement,
    caseSensitive: matchCase,
    literal: true,
  }), [searchMode, searchText, replacement, matchCase])
  const pendingChanges = documents.some(isDirty)
  const activeDirty = isDirty(active)

  useEffect(() => {
    const ids = new Set(documents.map((doc) => doc.id))
    for (const id of buffers.current.keys()) {
      if (!ids.has(id)) buffers.current.delete(id)
    }
  }, [documents])

  useEffect(() => {
    if (!pendingChanges) return
    function protect(event) {
      event.preventDefault()
      event.returnValue = true
    }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [pendingChanges])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 5200)
    return () => clearTimeout(id)
  }, [toast])

  function patchDocument(id, patch) {
    setDocuments((current) => current.map((doc) => doc.id === id ? { ...doc, ...patch } : doc))
  }

  function activate(id) {
    setSimulationLine(null)
    setActiveId(id)
  }

  function addDocuments(incoming) {
    if (!incoming.length) return
    setDocuments((current) => [...current, ...incoming])
    activate(incoming.at(-1).id)
    setExpanded(false)
  }

  function createProgram() {
    const used = new Set(documents.map(({ name }) => name))
    let name = 'Без имени.nc'
    for (let number = 2; used.has(name); number += 1) name = `Без имени ${number}.nc`
    addDocuments([newDocument({ name })])
    requestAnimationFrame(() => editor.current?.focus())
  }

  function openExample() {
    const existing = documents.find((doc) => doc.isDemo && !isDirty(doc))
    if (existing) {
      activate(existing.id)
      setExpanded(false)
    } else addDocuments([demoDocument()])
  }

  async function pickPrograms(multiple) {
    if (window.kontur) return window.kontur.openPrograms(multiple)
    const picker = multiple ? selectFiles.current : compareFile.current
    return readPicker(picker)
  }

  function importResults(results) {
    const opened = new Map()
    const failures = []
    let selected = null
    for (const result of results) {
      try {
        if (result.error) throw new Error(result.error)
        const existing = result.fileId && (documents.find((doc) => doc.fileId === result.fileId) || opened.get(result.fileId))
        selected = existing ?? newDocument(decodeFile(result))
        if (!existing) opened.set(result.fileId ?? selected.id, selected)
      } catch (error) {
        failures.push(`${result.name}: ${error.message}`)
      }
    }
    if (opened.size) setDocuments((current) => [...current, ...opened.values()])
    if (selected) {
      activate(selected.id)
      setExpanded(false)
    }
    if (failures.length) setToast({ error: true, text: failures.join(' ') })
  }

  async function openPrograms() {
    if (isOpening.current) return
    isOpening.current = true
    try {
      importResults(await pickPrograms(true))
    } catch (error) {
      setToast({ error: true, text: error.message })
    } finally {
      isOpening.current = false
    }
  }

  async function openComparison() {
    const [result] = await pickPrograms(false)
    if (!result) return null
    if (result.error) throw new Error(result.error)
    return decodeFile(result)
  }

  async function save(doc = active, as = false, onError) {
    if (saveGuard.current) return false
    saveGuard.current = true
    setSaving(true)
    setToast(null)
    try {
      const occupiedIds = documents.filter((other) => other.id !== doc.id && other.fileId).map((other) => other.fileId)
      const stored = await saveProgram(doc, as, occupiedIds)
      if (!stored) return false
      patchDocument(doc.id, {
        name: stored.name, fileId: stored.fileId, isDemo: false,
        savedText: doc.text, savedLineEnding: doc.lineEnding, savedEncoding: doc.encoding, savedBom: doc.bom,
      })
      setToast({ text: `Сохранён файл ${stored.name}` })
      return true
    } catch (error) {
      if (onError) onError(error.message)
      else setToast({ error: true, text: error.message })
      return false
    } finally {
      saveGuard.current = false
      setSaving(false)
    }
  }

  function remove(id) {
    const remaining = documents.filter((doc) => doc.id !== id)
    if (!remaining.length) remaining.push(newDocument())
    setDocuments(remaining)
    if (active.id === id) {
      const index = documents.findIndex((doc) => doc.id === id)
      activate(remaining[Math.min(index, remaining.length - 1)].id)
    }
  }

  function close(id = active.id) {
    const closing = documents.find((doc) => doc.id === id)
    if (!closing) return
    if (isDirty(closing)) setDialog({ type: 'unsaved', id })
    else remove(id)
  }

  function showSearch(mode) {
    setExpanded(false)
    const selected = editor.current?.selectedText()
    if (selected && !selected.includes('\n')) setSearchText(selected)
    setSearchMode(mode)
    requestAnimationFrame(() => {
      const input = workspace.current?.querySelector('.search-input input')
      input?.focus()
      input?.select()
    })
  }

  function closeSearch() {
    setSearchMode(null)
    editor.current?.focus()
  }

  const actions = {
    newFile: createProgram,
    open: openPrograms,
    save: () => save(),
    find: () => showSearch('find'),
    replace: () => showSearch('replace'),
    compare: () => setDialog({ type: 'compare' }),
    renumber: () => setDialog({ type: 'renumber' }),
    check: () => {
      setExpanded(false)
      setDiagnosticsOpen(true)
    },
    simulate: () => viewer.current?.togglePlayback(),
  }
  const menus = [
    { title: 'Файл', items: [
      ['Новая программа', 'Ctrl+N', actions.newFile],
      ['Открыть…', 'Ctrl+O', actions.open],
      ['Открыть пример', null, openExample],
      ['Сохранить', 'Ctrl+S', actions.save, saving],
      ['Сохранить как…', 'Ctrl+Shift+S', () => save(active, true), saving],
      ['Закрыть вкладку', null, () => close()],
    ] },
    { title: 'Правка', items: [
      ['Отменить', 'Ctrl+Z', () => { editor.current?.undo(); editor.current?.focus() }],
      ['Повторить', 'Ctrl+Shift+Z', () => { editor.current?.redo(); editor.current?.focus() }],
      ['Найти…', 'Ctrl+F', actions.find],
      ['Заменить…', 'Ctrl+H', actions.replace],
    ] },
    { title: 'Вид', items: [
      [expanded ? 'Вернуть редактор' : 'Только траектория', null, () => setExpanded(!expanded)],
      [diagnosticsOpen ? 'Свернуть диагностику' : 'Открыть диагностику', null, () => {
        setExpanded(false)
        setDiagnosticsOpen(!diagnosticsOpen)
      }],
      ['Вписать траекторию', null, () => viewer.current?.fit()],
      ['Изометрия', null, () => setView('3D')],
      ['Проекция XY', null, () => setView('XY')],
      ['Проекция XZ', null, () => setView('XZ')],
      ['Проекция YZ', null, () => setView('YZ')],
    ] },
    { title: 'Инструменты', items: [
      ['Сравнить программы…', null, actions.compare],
      ['Перенумеровать кадры…', null, actions.renumber],
      ['Проверить синтаксис', 'F8', actions.check],
      [playing ? 'Приостановить симуляцию' : 'Запустить симуляцию', 'F9', actions.simulate, !model.moves.length],
    ] },
  ]

  keyboard.current = (event) => {
    if (event.defaultPrevented || dialog) return
    const key = event.key.toLowerCase()
    let invoke
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      invoke = {
        n: actions.newFile, o: actions.open, s: event.shiftKey ? () => save(active, true) : actions.save,
        f: actions.find, h: actions.replace,
      }[key]
    } else if (key === 'f8') invoke = actions.check
    else if (key === 'f9') invoke = actions.simulate
    else if (key === 'escape' && searchMode) invoke = closeSearch
    if (invoke) {
      event.preventDefault()
      if (!event.repeat) invoke()
    }
  }
  useEffect(() => {
    const run = (event) => keyboard.current(event)
    window.addEventListener('keydown', run, true)
    return () => window.removeEventListener('keydown', run, true)
  }, [])

  function dragFile(event) {
    if (event.dataTransfer.types.includes('Files')) event.preventDefault()
  }

  async function dropFile(event) {
    if (!event.dataTransfer.files.length) return
    event.preventDefault()
    importResults(await browserFiles(event.dataTransfer.files))
  }

  function dragDivider(event) {
    if (event.button !== 0) return
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveDivider(event) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const rect = workspace.current.getBoundingClientRect()
    setSplit(Math.max(30, Math.min(68, 100 * (event.clientX - rect.left) / rect.width)))
  }

  function closeDialog() {
    setDialog(null)
  }

  const status = activeDirty ? 'Есть несохранённые изменения' : active.isDemo ? 'Демонстрационный файл' : 'Локальная программа'
  const closing = dialog?.type === 'unsaved' ? documents.find((doc) => doc.id === dialog.id) : null

  return (
    <div className="app" onDragOver={dragFile} onDrop={dropFile}>
      <Header menus={menus} status={status} dirty={activeDirty} onHelp={() => setDialog({ type: 'help' })} />
      <Toolbar actions={actions} disabledActions={{ save: saving }} playing={playing}
        canPlay={model.moves.length > 0} searchMode={searchMode} />
      <main className="workspace" ref={workspace} data-expanded={expanded} style={{ '--editor-share': `${split}%` }}>
        <section className="editor-pane" aria-label="Редактор программы">
          <Tabs documents={documents} activeId={active.id} isDirty={isDirty}
            onSelect={activate} onClose={close} onNew={createProgram} />
          <div className="editor-caption">
            <span>КОД ПРОГРАММЫ</span>
            <span>{model.lineCount.toLocaleString('ru-RU')} СТРОК</span>
          </div>
          {searchMode && <SearchBar mode={searchMode} searchText={searchText} setSearchText={setSearchText}
            replacement={replacement} setReplacement={setReplacement} matchCase={matchCase} setMatchCase={setMatchCase}
            editor={editor} activeId={active.id} documentText={active.text} onClose={closeSearch} />}
          <CodeEditor ref={editor} document={active} buffers={buffers} query={query} simulationLine={simulationLine}
            followSimulation={!expanded} onChange={(id, text) => patchDocument(id, { text })}
            onCursor={(line, column) => setCursor({ line, column })} />
          <Diagnostics model={model} open={diagnosticsOpen} onToggle={() => setDiagnosticsOpen(!diagnosticsOpen)}
            onSelect={(line, column) => editor.current?.goTo(line, column)} />
        </section>
        <div className="splitter" tabIndex={0} role="separator" aria-label="Ширина редактора" aria-orientation="vertical"
          aria-valuemin={30} aria-valuemax={68} aria-valuenow={Math.round(split)} onPointerDown={dragDivider}
          onPointerMove={moveDivider} onDoubleClick={() => setSplit(42)} onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
            event.preventDefault()
            setSplit((current) => Math.max(30, Math.min(68, current + (event.key === 'ArrowRight' ? 2 : -2))))
          }}><i /></div>
        <ToolpathViewer ref={viewer} model={model} documentId={active.id} view={view} setView={setView}
          expanded={expanded} onExpand={() => setExpanded(!expanded)} onSimulationLine={setSimulationLine}
          onRunningChange={setPlaying} />
      </main>
      <StatusBar status={saving ? 'Сохранение…' : 'Готово'} cursor={cursor} document={active}
        onFormat={(change) => patchDocument(active.id, change)} />
      <input id="open-programs" type="file" accept={FILE_ACCEPT} multiple hidden ref={selectFiles} />
      <input id="compare-program" type="file" accept={FILE_ACCEPT} hidden ref={compareFile} />
      {toast && <div className={`toast${toast.error ? ' toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}>
        {toast.error ? <CircleAlert size={19} /> : <CircleCheck size={19} />}<span>{toast.text}</span>
        <button type="button" className="icon-button" title="Закрыть уведомление" aria-label="Закрыть уведомление"
          onClick={() => setToast(null)}><X size={16} /></button>
      </div>}
      {dialog?.type === 'renumber' && <RenumberDialog document={active} onClose={closeDialog} onApply={(text) => {
        setExpanded(false)
        if (text !== active.text) editor.current?.applyText(text)
        closeDialog()
        requestAnimationFrame(() => editor.current?.focus())
      }} />}
      {dialog?.type === 'compare' && <CompareDialog source={active} alternatives={documents.filter((doc) => doc.id !== active.id)}
        onBrowse={openComparison} onClose={closeDialog} />}
      {dialog?.type === 'help' && <HelpDialog onClose={closeDialog} />}
      {closing && <UnsavedDialog document={closing} saving={saving} onClose={closeDialog} onDiscard={() => {
        remove(closing.id)
        closeDialog()
      }} onSave={async (onError) => {
        if (await save(closing, false, onError)) {
          closeDialog()
          remove(closing.id)
        }
      }} />}
    </div>
  )
}
