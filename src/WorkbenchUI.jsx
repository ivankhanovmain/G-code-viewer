import {
  ArrowDown, ArrowUp, CaseSensitive, ChevronDown, ChevronUp, CircleAlert, CircleCheck, FileCode2, FilePlus2,
  FolderOpen, GitCompareArrows, Keyboard, Layers3, ListOrdered, Menu, PanelBottom, Pause, Play, Plus, Replace,
  Save, Search, TriangleAlert, X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function Header({ menus, status, dirty, onHelp }) {
  const [openMenu, setOpenMenu] = useState(null)
  const menuRoot = useRef(null)

  useEffect(() => {
    if (openMenu === null) return
    function outside(event) {
      if (!menuRoot.current.contains(event.target)) setOpenMenu(null)
    }
    function escape(event) {
      if (event.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [openMenu])

  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-icon"><Layers3 size={21} strokeWidth={2} /></span>
        <div><strong>КОНТУР</strong><span>РЕДАКТОР G-КОДА</span></div>
      </div>
      <nav className="app-menus" aria-label="Главное меню" ref={menuRoot}>
        <button className="compact-menu icon-button" type="button" aria-label="Меню"
          aria-expanded={openMenu === 'all'} onClick={() => setOpenMenu(openMenu === 'all' ? null : 'all')}><Menu size={20} /></button>
        {menus.map(({ title, items }) => (
          <div className="menu-wrapper" key={title}>
            <button type="button" className="menu-trigger" aria-expanded={openMenu === title}
              onClick={() => setOpenMenu(openMenu === title ? null : title)}>{title}</button>
            {openMenu === title && <div className="menu-popover"><MenuItems items={items} onClose={() => setOpenMenu(null)} /></div>}
          </div>
        ))}
        {openMenu === 'all' && <div className="menu-popover compact-popover">
          {menus.map(({ title, items }) => <div key={title}><div className="menu-label">{title}</div>
            <MenuItems items={items} onClose={() => setOpenMenu(null)} /></div>)}
        </div>}
      </nav>
      <div className="header-aside">
        <span className={`session-status${dirty ? ' has-changes' : ''}`}><i />{status}</span>
        <button type="button" className="icon-button help-button" title="Горячие клавиши" aria-label="Горячие клавиши"
          onClick={onHelp}><Keyboard size={19} /></button>
      </div>
    </header>
  )
}

function MenuItems({ items, onClose }) {
  return items.map(([label, key, action, disabled]) => (
    <button type="button" className="menu-entry" key={label} disabled={disabled} onClick={() => {
      onClose()
      action()
    }}><span>{label}</span>{key && <kbd>{key}</kbd>}</button>
  ))
}

const TOOL_GROUPS = [
  [
    ['newFile', 'Новый', 'Ctrl+N', FilePlus2],
    ['open', 'Открыть', 'Ctrl+O', FolderOpen],
    ['save', 'Сохранить', 'Ctrl+S', Save],
  ],
  [
    ['find', 'Поиск', 'Ctrl+F', Search],
    ['replace', 'Заменить', 'Ctrl+H', Replace],
    ['compare', 'Сравнить', null, GitCompareArrows],
  ],
  [
    ['renumber', 'Перенумеровать', null, ListOrdered],
    ['check', 'Проверить', 'F8', CircleCheck],
  ],
]

export function Toolbar({ actions, disabledActions, playing, canPlay, searchMode }) {
  return (
    <div className="toolbar" role="group" aria-label="Команды редактора">
      {TOOL_GROUPS.map((group) => (
        <div className="tool-group" key={group[0][0]}>
          {group.map(([id, label, shortcut, Icon]) => (
            <button type="button" className="tool-button" key={id} onClick={actions[id]} aria-label={label}
              aria-pressed={['find', 'replace'].includes(id) ? searchMode === id : undefined}
              disabled={disabledActions[id]} title={shortcut ? `${label} (${shortcut})` : label}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
            </button>
          ))}
        </div>
      ))}
      <button type="button" className="simulation-button" onClick={actions.simulate} disabled={!canPlay}
        title={playing ? 'Приостановить симуляцию (F9)' : 'Запустить симуляцию (F9)'}
        aria-label={playing ? 'Приостановить симуляцию' : 'Запустить симуляцию'}>
        {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        <span>{playing ? 'Пауза' : 'Симуляция'}</span>
      </button>
    </div>
  )
}

export function Tabs({ documents, activeId, isDirty, onSelect, onClose, onNew }) {
  const active = useRef(null)
  useEffect(() => {
    active.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  return (
    <div className="tabs">
      <div className="tab-strip" aria-label="Открытые программы">
        {documents.map((doc) => (
          <div className={`file-tab${doc.id === activeId ? ' is-active' : ''}`} key={doc.id}
            ref={doc.id === activeId ? active : null}>
            <button type="button" className="file-tab-name" aria-current={doc.id === activeId ? 'page' : undefined}
              onClick={() => onSelect(doc.id)} title={doc.name}>
              <FileCode2 size={15} /><span>{doc.name}</span>{isDirty(doc) && <i title="Есть несохранённые изменения" />}
            </button>
            <button type="button" className="icon-button close-tab" onClick={() => onClose(doc.id)}
              title="Закрыть вкладку" aria-label={`Закрыть ${doc.name}`}><X size={14} /></button>
          </div>
        ))}
        <button type="button" className="icon-button new-tab" onClick={onNew} title="Новая вкладка" aria-label="Новая вкладка">
          <Plus size={17} />
        </button>
      </div>
    </div>
  )
}

export function SearchBar({ mode, searchText, setSearchText, replacement, setReplacement, matchCase, setMatchCase,
  editor, activeId, documentText, onClose }) {
  const focus = useRef(null)
  const [count, setCount] = useState(0)

  useEffect(() => {
    focus.current?.focus()
    focus.current?.select()
  }, [mode, activeId])

  useEffect(() => {
    setCount(editor.current?.matchCount() ?? 0)
  }, [editor, activeId, documentText, matchCase, replacement, searchText])

  function run(action) {
    editor.current?.runSearch(action)
  }

  return (
    <section className="search-bar" aria-label={mode === 'replace' ? 'Поиск и замена' : 'Поиск в программе'}>
      <div className="search-row">
        <label className="search-input"><Search size={15} /><input ref={focus} type="search" placeholder="Найти в программе"
          aria-label="Найти в программе" value={searchText} onChange={(event) => setSearchText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              run(event.shiftKey ? 'previous' : 'next')
            }
          }} /></label>
        <span className="match-count" aria-live="polite">{searchText ? (count === 10000 ? '10 000+' : count) : '—'}</span>
        <button type="button" className="icon-button" aria-label="Предыдущее совпадение" title="Предыдущее совпадение"
          onClick={() => run('previous')} disabled={!count}><ArrowUp size={16} /></button>
        <button type="button" className="icon-button" aria-label="Следующее совпадение" title="Следующее совпадение"
          onClick={() => run('next')} disabled={!count}><ArrowDown size={16} /></button>
        <button type="button" className="icon-button" aria-label="Учитывать регистр" title="Учитывать регистр"
          aria-pressed={matchCase} onClick={() => setMatchCase(!matchCase)}><CaseSensitive size={19} /></button>
        <button type="button" className="icon-button" aria-label="Закрыть поиск" title="Закрыть поиск"
          onClick={onClose}><X size={16} /></button>
      </div>
      {mode === 'replace' && <div className="search-row">
        <label className="search-input"><Replace size={15} /><input placeholder="Заменить на" aria-label="Заменить на"
          value={replacement} onChange={(event) => setReplacement(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              run('replace')
            }
          }} /></label>
        <button type="button" className="small-button" onClick={() => run('replace')} disabled={!count}>Заменить</button>
        <button type="button" className="small-button" onClick={() => run('replaceAll')} disabled={!count}>Все</button>
      </div>}
    </section>
  )
}

export function Diagnostics({ model, open, onToggle, onSelect }) {
  const issues = model.issues
  const errors = issues.filter((issue) => issue.severity === 'error').length
  const warnings = issues.length - errors
  return (
    <section className="diagnostics" aria-label="Диагностика">
      <button type="button" className="diagnostics-header" onClick={onToggle} aria-expanded={open}>
        <PanelBottom size={15} /><span>Диагностика</span>
        <span className={`issue-count${issues.length ? (errors ? ' has-errors' : ' has-warnings') : ''}`}>{issues.length}</span>
        <span className="diagnostics-toggle">{open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</span>
      </button>
      {open && (
        <div className="diagnostics-body" aria-live="polite">
          {issues.length ? (
            <>
              <div className="issue-summary">Ошибки: {errors}<i />Предупреждения: {warnings}</div>
              <ul className="issue-list">
                {issues.slice(0, 300).map((issue, index) => (
                  <li key={index}><button type="button" onClick={() => onSelect(issue.line, issue.column)}>
                    {issue.severity === 'error' ? <CircleAlert size={15} className="error-icon" />
                      : <TriangleAlert size={15} className="warning-icon" />}
                    <code>{issue.line}:{issue.column}</code><span>{issue.message}</span>
                  </button></li>
                ))}
              </ul>
              {issues.length > 300 && <div className="issue-summary">Показаны первые 300 сообщений.</div>}
            </>
          ) : (
            <div className="diagnostics-ok">
              <div className="ok-indicator"><CircleCheck size={19} strokeWidth={1.8} /></div>
              <div><strong>Ошибок синтаксиса нет</strong><span>Проверено строк: {model.lineCount.toLocaleString('ru-RU')}</span></div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export function StatusBar({ status, cursor, document, onFormat }) {
  return (
    <footer className="status-bar">
      <span className="status-ready"><i />{status}</span>
      <span className="status-mode">ISO · Фрезерование</span>
      <div className="status-document">
        <span>Стр. {cursor.line}, стлб. {cursor.column}</span>
        <label title="Кодировка"><select aria-label="Кодировка" value={document.encoding} onChange={(event) => onFormat({ encoding: event.target.value, bom: false })}>
          <option>UTF-8</option><option>Windows-1251</option>
        </select></label>
        <label title="Окончания строк"><select aria-label="Окончания строк" value={document.lineEnding}
          onChange={(event) => onFormat({ lineEnding: event.target.value })}><option>LF</option><option>CRLF</option><option>CR</option></select></label>
      </div>
    </footer>
  )
}
