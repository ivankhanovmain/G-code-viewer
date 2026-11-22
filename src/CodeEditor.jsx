import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import {
  Decoration, EditorView, ViewPlugin, drawSelection, highlightActiveLine, highlightActiveLineGutter,
  keymap, lineNumbers, placeholder,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, search, setSearchQuery } from '@codemirror/search'
import { tags } from '@lezer/highlight'
import { scanLine } from './gcode.js'

const language = StreamLanguage.define({
  startState: () => ({ tokens: [], index: 0 }),
  token(stream, state) {
    if (stream.sol()) {
      state.tokens = scanLine(stream.string)
      state.index = 0
    }
    if (stream.eatSpace()) return null
    const token = state.tokens[state.index++]
    if (!token) {
      stream.next()
      return null
    }
    stream.pos = token.end
    if (token.kind === 'comment') return 'comment'
    if (token.kind === 'invalid') return 'invalid'
    if (token.kind !== 'word') return 'punctuation'
    if ('GM'.includes(token.letter)) return 'keyword'
    if ('NO'.includes(token.letter)) return 'labelName'
    if ('FST'.includes(token.letter)) return 'variableName'
    return 'number'
  },
})
const highlighting = HighlightStyle.define([
  { tag: tags.comment, class: 'token-comment' },
  { tag: tags.invalid, class: 'token-invalid' },
  { tag: tags.punctuation, class: 'token-label' },
  { tag: tags.keyword, class: 'token-command' },
  { tag: tags.labelName, class: 'token-label' },
  { tag: tags.variableName, class: 'token-parameter' },
  { tag: tags.number, class: 'token-number' },
])

const highlightBlock = StateEffect.define()
const blockMarker = StateField.define({
  create: () => Decoration.none,
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(highlightBlock)) continue
      const line = effect.value
      return line && line <= transaction.newDoc.lines
        ? Decoration.set(Decoration.line({ class: 'cm-simulationLine' }).range(transaction.newDoc.line(line).from))
        : Decoration.none
    }
    return decorations.map(transaction.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

const match = Decoration.mark({ class: 'cm-queryMatch' })
const currentMatch = Decoration.mark({ class: 'cm-queryMatch cm-queryMatch-selected' })

function markMatches(view) {
  const query = getSearchQuery(view.state)
  if (!query.valid) return Decoration.none
  const ranges = []
  const selection = view.state.selection.main
  for (const { from, to } of view.visibleRanges) {
    const cursor = query.getCursor(view.state, from, to)
    while (!cursor.next().done) {
      const result = cursor.value
      const marker = result.from === selection.from && result.to === selection.to ? currentMatch : match
      ranges.push(marker.range(result.from, result.to))
    }
  }
  return Decoration.set(ranges, true)
}

const matchMarkers = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = markMatches(view)
  }

  update(update) {
    if (update.docChanged || update.viewportChanged || update.selectionSet ||
        !getSearchQuery(update.state).eq(getSearchQuery(update.startState))) {
      this.decorations = markMatches(update.view)
    }
  }
}, { decorations: (plugin) => plugin.decorations })

const extensions = [
  lineNumbers(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  drawSelection(),
  history(),
  language,
  syntaxHighlighting(highlighting),
  placeholder('Введите или откройте программу G-кода…'),
  search(),
  matchMarkers,
  blockMarker,
  keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
  EditorView.contentAttributes.of({ 'aria-label': 'Редактор G-кода', spellcheck: 'false' }),
]

const operations = { next: findNext, previous: findPrevious, replace: replaceNext, replaceAll }

export const CodeEditor = forwardRef(function CodeEditor({
  document, buffers, query, simulationLine, followSimulation, onChange, onCursor,
}, ref) {
  const root = useRef(null)
  const instance = useRef(null)
  const callbacks = useRef(null)
  callbacks.current = { onChange, onCursor }

  function reportCursor(state) {
    const position = state.selection.main.head
    const line = state.doc.lineAt(position)
    callbacks.current.onCursor(line.number, position - line.from + 1)
  }

  useLayoutEffect(() => {
    const { id, text } = document
    const buffered = buffers.current.get(id)
    const state = buffered?.state ?? EditorState.create({
      doc: text,
      extensions: [
        ...extensions,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onChange(id, update.state.doc.toString())
          if (update.docChanged || update.selectionSet) reportCursor(update.state)
        }),
      ],
    })
    const view = new EditorView({ state, parent: root.current })
    instance.current = view
    reportCursor(view.state)
    const restore = requestAnimationFrame(() => {
      if (buffered) view.scrollDOM.scrollTop = buffered.scrollTop
    })
    return () => {
      cancelAnimationFrame(restore)
      buffers.current.set(id, { state: view.state, scrollTop: view.scrollDOM.scrollTop })
      view.destroy()
      instance.current = null
    }
  }, [document.id, buffers])

  useLayoutEffect(() => {
    instance.current?.dispatch({ effects: setSearchQuery.of(query) })
  }, [document.id, query])

  useLayoutEffect(() => {
    const view = instance.current
    if (!view) return
    const effects = [highlightBlock.of(simulationLine)]
    if (followSimulation && simulationLine && simulationLine <= view.state.doc.lines) {
      const { from } = view.state.doc.line(simulationLine)
      effects.push(EditorView.scrollIntoView(from, { y: 'nearest' }))
    }
    view.dispatch({ effects })
  }, [document.id, simulationLine, followSimulation])

  useImperativeHandle(ref, () => ({
    focus: () => instance.current?.focus(),
    undo: () => instance.current && undo(instance.current),
    redo: () => instance.current && redo(instance.current),
    selectedText() {
      const { state } = instance.current
      const { from, to } = state.selection.main
      return state.sliceDoc(from, to)
    },
    goTo(line, column = 1) {
      const view = instance.current
      const { from, to } = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)))
      view.dispatch({ selection: { anchor: Math.min(to, from + column - 1) }, scrollIntoView: true })
      view.focus()
    },
    applyText(text) {
      const view = instance.current
      if (!view) return
      const { from } = view.state.doc.lineAt(view.state.selection.main.head)
      const line = view.state.doc.lineAt(from).number
      const changes = view.state.changes({ from: 0, to: view.state.doc.length, insert: text })
      const nextDoc = changes.apply(view.state.doc)
      view.dispatch({
        changes,
        selection: { anchor: nextDoc.line(Math.min(line, nextDoc.lines)).from },
        userEvent: 'input',
      })
    },
    runSearch(action) {
      const view = instance.current
      if (view && getSearchQuery(view.state).valid) return operations[action]?.(view)
      return false
    },
    matchCount() {
      const view = instance.current
      if (!view) return 0
      const spec = getSearchQuery(view.state)
      if (!spec.valid) return 0
      const cursor = spec.getCursor(view.state)
      let count = 0
      while (count < 10000 && !cursor.next().done) count += 1
      return count
    },
  }), [])

  return <div className="code-editor" ref={root} />
})
