import { FileDiff, FolderOpen, Keyboard, ListOrdered, TriangleAlert, X } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { comparePrograms } from './comparison.js'
import { hasLineJumps, MAX_BLOCK_NUMBER, renumberProgram } from './gcode.js'

function Modal({ title, icon: Icon, onClose, children, wide = false }) {
  const modal = useRef(null)
  const titleId = useRef(`dialog-${title === 'Сравнение программ' ? 'compare' : 'title'}`)
  useLayoutEffect(() => {
    const dialog = modal.current
    const before = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (before instanceof HTMLElement && before.isConnected && !before.hidden) before.focus({ preventScroll: true })
    }
  }, [])

  return (
    <dialog ref={modal} className={`modal${wide ? ' modal-wide' : ''}`} aria-labelledby={titleId.current}
      onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => {
        if (event.target === modal.current) onClose()
      }}>
      <div className="modal-box">
        <header className="modal-heading">
          {Icon && <span className="modal-icon"><Icon size={20} /></span>}
          <h2 id={titleId.current}>{title}</h2>
          <button type="button" className="icon-button" aria-label="Закрыть окно" onClick={onClose}><X size={19} /></button>
        </header>
        {children}
      </div>
    </dialog>
  )
}

export function RenumberDialog({ document, onApply, onClose }) {
  const [start, setStart] = useState('10')
  const [step, setStep] = useState('10')
  const jumps = useMemo(() => hasLineJumps(document.text), [document.text])
  const valid = /^\d+$/.test(start) && /^\d+$/.test(step) && Number(start) <= MAX_BLOCK_NUMBER &&
    Number(step) > 0 && Number(step) <= MAX_BLOCK_NUMBER
  const result = useMemo(() => valid && !jumps ? renumberProgram(document.text, Number(start), Number(step)) : null,
    [document.text, start, step, valid, jumps])
  const overflow = valid && !jumps && result === null
  return (
    <Modal title="Перенумерация кадров" icon={ListOrdered} onClose={onClose}>
      <form onSubmit={(event) => {
        event.preventDefault()
        if (result !== null) onApply(result)
      }}>
        <div className="modal-content">
          <p>Обновите номера <code>N</code> в программе <strong>{document.name}</strong>.</p>
          <div className="form-columns">
            <label>Первый номер<input type="number" min="0" max={MAX_BLOCK_NUMBER} value={start}
              onChange={(event) => setStart(event.target.value)} autoFocus required /></label>
            <label>Шаг<input type="number" min="1" max={MAX_BLOCK_NUMBER} value={step}
              onChange={(event) => setStep(event.target.value)} required /></label>
          </div>
          {jumps && <p className="form-error">В программе есть переходы по номерам кадров. Нумерация защищена от изменений.</p>}
          {overflow && <p className="form-error">Последний номер превышает 999999. Уменьшите первый номер или шаг.</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" disabled={jumps}
            onClick={() => onApply(renumberProgram(document.text, 0, 0, true))}>Убрать номера</button>
          <button type="button" className="secondary-button" onClick={onClose}>Отмена</button>
          <button type="submit" className="primary-button" disabled={result === null}>Применить</button>
        </div>
      </form>
    </Modal>
  )
}

export function CompareDialog({ source, alternatives, onBrowse, onClose }) {
  const [selectedId, setSelectedId] = useState(alternatives[0]?.id ?? '')
  const [external, setExternal] = useState(null)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState('')
  const [onlyChanges, setOnlyChanges] = useState(false)
  const target = external ?? alternatives.find((doc) => String(doc.id) === String(selectedId))
  const comparison = useMemo(() => target ? comparePrograms(source.text, target.text) : null, [source.text, target])
  const rows = useMemo(() => {
    if (!comparison) return []
    return onlyChanges ? comparison.rows.filter((row) => row.changed) : comparison.rows
  }, [comparison, onlyChanges])

  async function browse() {
    setPending(true)
    setNotice('')
    try {
      const file = await onBrowse()
      if (file) {
        setExternal(file)
        setSelectedId('')
      }
    } catch (error) {
      setNotice(error.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal title="Сравнение программ" icon={FileDiff} onClose={onClose} wide>
      <div className="compare-options">
        {alternatives.length > 0 && <label className="compare-select"><span>Вторая программа</span>
          <select value={selectedId} onChange={(event) => { setExternal(null); setSelectedId(event.target.value) }}>
            <option value="">Выберите вкладку</option>
            {alternatives.map((doc) => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
          </select></label>}
        <button type="button" className="secondary-button" disabled={pending} onClick={browse}><FolderOpen size={16} /> Открыть файл</button>
        {comparison && <label className="only-changes"><input type="checkbox" checked={onlyChanges}
          onChange={(event) => setOnlyChanges(event.target.checked)} /> Только изменения</label>}
      </div>
      {notice && <p className="compare-notice form-error">{notice}</p>}
      {!target ? <div className="compare-empty"><FileDiff size={34} /><strong>Выберите вторую программу</strong>
        <span>Слева будет показан файл {source.name}.</span></div>
        : !comparison ? <div className="compare-empty"><TriangleAlert size={29} /><strong>Слишком большое сравнение</strong>
          <span>Сравните файлы с меньшим количеством строк или изменений.</span></div>
          : <>
            <div className="compare-names"><span>{source.name}</span><span>{target.name}</span></div>
            <div className="compare-scroll" tabIndex={0} aria-label="Различия между программами">
              {rows.map(({ left, right, changed }, index) => <div className="diff-row" key={index}>
                <DiffCell side={left} variant={changed ? 'removed' : ''} />
                <DiffCell side={right} variant={changed ? 'added' : ''} />
              </div>)}
              {!rows.length && <div className="diff-identical">Программы совпадают.</div>}
            </div>
            <div className="compare-summary">
              {comparison.addedCount || comparison.removedCount
                ? <><span className="delta-added">+{comparison.addedCount}</span><span className="delta-removed">−{comparison.removedCount}</span> строк</>
                : 'Программы совпадают'}
            </div>
          </>}
      <div className="modal-actions"><button type="button" className="primary-button" onClick={onClose}>Закрыть</button></div>
    </Modal>
  )
}

function DiffCell({ side, variant }) {
  return (
    <div className={`diff-cell ${side ? variant : 'diff-blank'}`}>
      <span>{side?.line}</span>
      <code>{side && variant && <b>{variant === 'added' ? '+' : '−'}</b>}{side?.text}</code>
    </div>
  )
}

export function UnsavedDialog({ document, saving, onSave, onDiscard, onClose }) {
  const [error, setError] = useState('')
  return (
    <Modal title="Несохранённые изменения" icon={TriangleAlert} onClose={onClose}>
      <div className="modal-content">
        <p>Сохранить изменения в файле <strong>{document.name}</strong> перед закрытием?</p>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="modal-actions">
        <button type="button" className="danger-button" onClick={onDiscard}>Закрыть без сохранения</button>
        <button type="button" className="secondary-button" onClick={onClose} autoFocus>Отмена</button>
        <button type="button" className="primary-button" disabled={saving} onClick={() => {
          setError('')
          onSave(setError)
        }}>Сохранить</button>
      </div>
    </Modal>
  )
}

export function HelpDialog({ onClose }) {
  const shortcuts = [
    ['Новый файл', 'Ctrl+N'],
    ['Открыть программу', 'Ctrl+O'],
    ['Сохранить', 'Ctrl+S'],
    ['Сохранить как', 'Ctrl+Shift+S'],
    ['Поиск и замена', 'Ctrl+F / Ctrl+H'],
    ['Отменить / повторить', 'Ctrl+Z / Ctrl+Shift+Z'],
    ['Диагностика', 'F8'],
    ['Симуляция или пауза', 'F9'],
  ]
  return (
    <Modal title="Горячие клавиши" icon={Keyboard} onClose={onClose}>
      <div className="modal-content">
        <dl className="shortcuts">{shortcuts.map(([label, key]) => <div key={label}><dt>{label}</dt><dd><kbd>{key}</kbd></dd></div>)}</dl>
        <p className="help-details">Перетаскивание вращает 3D-вид. Правая кнопка или Shift перемещают вид, колесо меняет масштаб.</p>
        <p className="help-details">Щёлкните строку с перемещением или участок траектории. Кнопки «Начало» и «Конец» показывают выбранную точку кадра.</p>
      </div>
      <div className="modal-actions"><button type="button" className="primary-button" onClick={onClose}>Готово</button></div>
    </Modal>
  )
}
