import {
  Box, Crosshair, Grid2X2, Maximize2, Minimize2, Minus, Pause, Play, Plus, SkipBack, SkipForward,
} from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { simulationEndpoint, simulationFrame } from './gcode.js'
import { DEFAULT_CAMERA, ENDPOINT_COLORS, pickEndpoint, pickMove, renderMarker, renderScene } from './plot.js'

const VIEWS = ['3D', 'XY', 'XZ', 'YZ']
const SPEEDS = [0.5, 1, 2, 5, 10, 25]

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const fixed = (number, precision = 3) => (Math.abs(number) < 0.0005 ? 0 : number).toFixed(precision)

function formatTime(seconds) {
  const time = Math.floor(seconds)
  return [Math.floor(time / 60), time % 60].map((value) => String(value).padStart(2, '0')).join(':')
}

function integer(number) {
  return String(number).padStart(2, '0')
}

export const ToolpathViewer = forwardRef(function ToolpathViewer({
  model, documentId, editorSelection, view, setView, expanded, onExpand, onSimulationLine, onRunningChange,
}, ref) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [camera, setCamera] = useState(DEFAULT_CAMERA)
  const [visible, setVisible] = useState({ grid: true, rapid: true, cut: true })
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [engaged, setEngaged] = useState(false)
  const [inspection, setInspection] = useState(null)
  const [speed, setSpeed] = useState(1)
  const surface = useRef(null)
  const scene = useRef(null)
  const marker = useRef(null)
  const orientation = useRef(null)
  const drag = useRef(null)
  const clock = useRef(0)
  // A frame's end and the next frame's start share the same timeline time.
  const endpointFrame = inspection && simulationEndpoint(model, inspection.index, inspection.endpoint)
  const located = endpointFrame ?? simulationFrame(model, time)
  const frame = engaged ? located : null
  const disabled = !model.moves.length
  const { width, height } = size

  useLayoutEffect(() => {
    const observer = new ResizeObserver(([{ contentRect }]) => {
      setSize({ width: contentRect.width, height: contentRect.height })
    })
    observer.observe(surface.current)
    return () => observer.disconnect()
  }, [])

  const zoom = useCallback((factor) => {
    setCamera((current) => ({ ...current, zoom: clamp(current.zoom * factor, 0.13, 20) }))
  }, [])

  useEffect(() => {
    const element = surface.current
    const onWheel = (event) => {
      event.preventDefault()
      zoom(Math.exp(-clamp(event.deltaY, -140, 140) * 0.0025))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [zoom])

  useLayoutEffect(() => {
    if (!width || !height) return
    orientation.current = renderScene(scene.current, width, height, model, view, camera, visible)
  }, [width, height, model, view, camera, visible])

  useLayoutEffect(() => {
    if (!width || !height) return
    const showFrame = !frame || visible[frame.move.rapid ? 'rapid' : 'cut']
    renderMarker(marker.current, width, height, orientation.current, showFrame ? frame : null, inspection?.endpoint)
  }, [width, height, frame, model, view, camera, visible, inspection?.endpoint])

  useLayoutEffect(() => {
    const gesture = drag.current
    drag.current = null
    if (gesture?.element.hasPointerCapture(gesture.id)) gesture.element.releasePointerCapture(gesture.id)
    setCamera(DEFAULT_CAMERA)
  }, [documentId, view])

  useLayoutEffect(() => {
    clock.current = 0
    setTime(0)
    setPlaying(false)
    setEngaged(false)
    setInspection(null)
  }, [model, documentId])

  const inspectEndpoint = useCallback((index, endpoint) => {
    const target = simulationEndpoint(model, index, endpoint)
    if (!target) return
    clock.current = target.time
    setTime(target.time)
    setPlaying(false)
    setEngaged(true)
    setInspection({ index, endpoint })
  }, [model])

  useLayoutEffect(() => {
    if (!editorSelection) return
    const index = model.moves.findIndex((move) => move.line === editorSelection.line)
    if (index >= 0) inspectEndpoint(index, 'start')
  }, [editorSelection, model, inspectEndpoint])

  useEffect(() => {
    onSimulationLine(frame?.move.line ?? null)
  }, [frame?.move.line, onSimulationLine])

  useEffect(() => {
    onRunningChange(playing)
  }, [playing, onRunningChange])

  useLayoutEffect(() => {
    if (!playing) return
    let previous
    let id
    function advance(now) {
      if (previous !== undefined) {
        clock.current = Math.min(model.duration, clock.current + clamp((now - previous) / 1000, 0, 0.1) * speed)
        setTime(clock.current)
      }
      previous = now
      if (clock.current >= model.duration) {
        setPlaying(false)
      } else {
        id = requestAnimationFrame(advance)
      }
    }
    id = requestAnimationFrame(advance)
    return () => cancelAnimationFrame(id)
  }, [playing, model.duration, speed])

  function seek(seconds) {
    clock.current = clamp(seconds, 0, model.duration)
    setTime(clock.current)
    setEngaged(true)
    setInspection(null)
  }

  function togglePlayback() {
    if (disabled) return
    if (playing) {
      setPlaying(false)
      return
    }
    if (clock.current >= model.duration) seek(0)
    else setInspection(null)
    setEngaged(true)
    setPlaying(true)
  }

  function step(direction) {
    if (disabled) return
    const next = clamp(located.index + direction, 0, model.moves.length - 1)
    inspectEndpoint(next, 'start')
  }

  function fit() {
    setCamera((current) => ({ ...current, zoom: 1, x: 0, y: 0 }))
  }

  useImperativeHandle(ref, () => ({ togglePlayback, fit }))

  function startDrag(event) {
    if (event.button > 2 || drag.current) return
    const select = event.button === 0 && !event.shiftKey
    drag.current = {
      x: event.clientX, y: event.clientY, id: event.pointerId, element: event.currentTarget,
      pan: !select || view !== '3D', select, moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveDrag(event) {
    if (drag.current?.id !== event.pointerId) return
    const { x, y, pan, moved } = drag.current
    const dx = event.clientX - x
    const dy = event.clientY - y
    if (!moved && Math.hypot(dx, dy) < 4) return
    drag.current = { ...drag.current, x: event.clientX, y: event.clientY, moved: true }
    setCamera((current) => pan
      ? { ...current, x: current.x + dx, y: current.y + dy }
      : { ...current, yaw: current.yaw + dx * 0.008, pitch: clamp(current.pitch + dy * 0.006, 0.06, 1.53) })
  }

  function endDrag(event) {
    const gesture = drag.current
    if (gesture?.id !== event.pointerId) return
    drag.current = null
    if (event.type !== 'pointerup' || gesture.moved || !gesture.select || disabled || !orientation.current) return
    const rect = event.currentTarget.getBoundingClientRect()
    const pointer = [event.clientX - rect.left, event.clientY - rect.top]
    const { point } = orientation.current
    if (endpointFrame && visible[located.move.rapid ? 'rapid' : 'cut']) {
      const endpoint = pickEndpoint(located.move.points, point, pointer, inspection.endpoint)
      if (endpoint) {
        inspectEndpoint(located.index, endpoint)
        return
      }
    }
    const index = pickMove(model.moves, point, visible, pointer, located.index)
    if (index !== null) inspectEndpoint(index, 'start')
  }

  function toggleLayer(layer) {
    setVisible((current) => ({ ...current, [layer]: !current[layer] }))
  }

  const bounds = model.cutBounds ?? model.bounds
  const dimensions = bounds?.max.map((value, i) => Number((value - bounds.min[i]).toFixed(2)).toLocaleString('ru-RU'))
  const coordinates = located?.position ?? [0, 0, 0]
  const feed = located?.move.feed ?? 0
  const currentFrame = located ? integer(located.index + 1) : '00'

  return (
    <section className="viewer-pane" aria-label="Просмотр траектории">
      <div className="viewer-heading">
        <div className="pane-title"><Box size={17} /><span>Траектория</span></div>
        <div className="viewer-heading-actions">
          <div className="view-switch" role="group" aria-label="Проекция">
            {VIEWS.map((mode) => (
              <button key={mode} type="button" aria-pressed={view === mode} onClick={() => {
                if (view === mode) setCamera(DEFAULT_CAMERA)
                else setView(mode)
              }}>{mode}</button>
            ))}
          </div>
          <button type="button" className="icon-button expand-view" onClick={onExpand}
            title={expanded ? 'Вернуть редактор' : 'Развернуть траекторию'}
            aria-label={expanded ? 'Вернуть редактор' : 'Развернуть траекторию'}>
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>
      <div className="viewport" ref={surface}>
        <div className="canvas-interaction" onPointerDown={startDrag} onPointerMove={moveDrag}
          onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
          onContextMenu={(event) => event.preventDefault()} onDoubleClick={fit}>
          <canvas ref={scene} role="img"
            aria-label={bounds ? `Траектория инструмента, проекция ${view}, ${model.moves.length} перемещений` : 'Пустая область траектории'} />
          <canvas ref={marker} aria-hidden="true" />
        </div>
        {dimensions && (
          <div className="plot-metrics">
            <span>{model.cutBounds ? 'ГАБАРИТЫ РЕЗАНИЯ' : 'ГАБАРИТЫ ТРАЕКТОРИИ'}</span>
            <p>{dimensions.join(' × ')} <small>мм</small></p>
          </div>
        )}
        {disabled && <div className="empty-plot"><Box size={29} /><strong>Траектория пуста</strong>
          <span>Добавьте перемещения G00–G03 в программу.</span></div>}
        <div className="plot-tools" role="group" aria-label="Настройки траектории">
          <button type="button" title="Приблизить" aria-label="Приблизить" onClick={() => zoom(1.2)}><Plus size={17} /></button>
          <button type="button" title="Отдалить" aria-label="Отдалить" onClick={() => zoom(1 / 1.2)}><Minus size={17} /></button>
          <button type="button" title="Вписать в экран" aria-label="Вписать в экран" onClick={fit}><Crosshair size={16} /></button>
          <button type="button" title="Сетка" aria-label="Сетка" aria-pressed={visible.grid}
            onClick={() => toggleLayer('grid')}><Grid2X2 size={15} /></button>
        </div>
        <div className="plot-legend" aria-label="Слои траектории">
          <button type="button" aria-pressed={visible.cut} onClick={() => toggleLayer('cut')}><i className="legend-cut" />Резание</button>
          <button type="button" aria-pressed={visible.rapid} onClick={() => toggleLayer('rapid')}><i className="legend-rapid" />Холостой ход</button>
        </div>
      </div>
      <div className="frame-endpoints">
        <span className="frame-source">{located ? `Строка ${located.move.line}` : 'Кадр —'}</span>
        <div className="endpoint-switch" role="group" aria-label="Позиция в кадре">
          {[['start', 'Начало'], ['end', 'Конец']].map(([endpoint, label]) => (
            <button key={endpoint} type="button" title={`${label} кадра`} aria-label={`${label} кадра`}
              aria-pressed={inspection?.endpoint === endpoint} disabled={disabled}
              style={{ '--endpoint-color': ENDPOINT_COLORS[endpoint] }}
              onClick={() => inspectEndpoint(located.index, endpoint)}>
              <i className={`endpoint-icon ${endpoint}`} />{label}
            </button>
          ))}
        </div>
      </div>
      <div className="coordinate-bar">
        <span className="coordinate-title">ПОЗИЦИЯ</span>
        {coordinates.map((value, index) => (
          <span className="coordinate" key={index}><b className={`axis-${index}`}>{'XYZ'[index]}</b>{fixed(value)}</span>
        ))}
        <span className="coordinate-feed" title="Запрограммированная подача в миллиметрах в минуту">
          <b>F</b> {feed ? `${Number(feed.toFixed(2))} мм/мин` : '—'}
        </span>
      </div>
      <div className="playback">
        <div className="playback-buttons" role="group" aria-label="Воспроизведение">
          <button type="button" className="icon-button" title="Предыдущий кадр" aria-label="Предыдущий кадр"
            onClick={() => step(-1)} disabled={disabled}><SkipBack size={16} /></button>
          <button type="button" className="play-button" title={playing ? 'Пауза' : 'Воспроизвести'}
            aria-label={playing ? 'Пауза' : 'Воспроизвести'} onClick={togglePlayback} disabled={disabled}>
            {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
          </button>
          <button type="button" className="icon-button" title="Следующий кадр" aria-label="Следующий кадр"
            onClick={() => step(1)} disabled={disabled}><SkipForward size={16} /></button>
        </div>
        <div className="timeline">
          <input type="range" min="0" max={model.duration || 1} step="any" value={time}
            aria-label="Позиция в симуляции" aria-valuetext={formatTime(time)} disabled={disabled}
            style={{ '--progress': `${model.duration ? 100 * time / model.duration : 0}%` }}
            onChange={(event) => {
              setPlaying(false)
              seek(Number(event.target.value))
            }} />
          <div className="timeline-times"><span>{formatTime(time)}</span><span>{formatTime(model.duration)}</span></div>
        </div>
        <div className="frame-count" title="Текущий кадр / всего перемещений">{currentFrame}<span> / {integer(model.moves.length)}</span></div>
        <select className="speed-select" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}
          aria-label="Скорость воспроизведения" title="Скорость воспроизведения">
          {SPEEDS.map((value) => <option key={value} value={value}>{value.toLocaleString('ru-RU')}×</option>)}
        </select>
      </div>
    </section>
  )
})
