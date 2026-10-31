import { initEditor } from '@strudel/codemirror'

import { changedLineIndexes } from './merge.js'

function revealIn(container, el) {
    if (!container) return
    const c = container.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    if (r.top < c.top) container.scrollTop -= c.top - r.top
    else if (r.bottom > c.bottom) container.scrollTop += r.bottom - c.bottom
}

/**
 * Read-only Strudel editor (syntax highlighting, theme, line numbers) with an
 * optional remote cursor and highlighting of lines that differ from a base.
 */
export function createViewer(parent) {
    const view = initEditor({
        root: parent,
        initialCode: '',
        onChange: () => {},
    })
    view.contentDOM.contentEditable = 'false'
    view.dom.classList.add('viewer')

    const overlay = document.createElement('div')
    overlay.className = 'viewer-overlay'
    view.scrollDOM.append(overlay)

    let current = { code: '', compareCode: null, cursor: null }

    function pos(offset) {
        const coords = view.coordsAtPos(offset)
        if (!coords) return null
        const rect = view.scrollDOM.getBoundingClientRect()
        return {
            top: coords.top - rect.top + view.scrollDOM.scrollTop,
            bottom: coords.bottom - rect.top + view.scrollDOM.scrollTop,
            left: coords.left - rect.left + view.scrollDOM.scrollLeft,
        }
    }

    function drawOverlay() {
        overlay.replaceChildren()
        const { code, compareCode, cursor } = current
        if (typeof compareCode === 'string') {
            const changed = changedLineIndexes(compareCode, code)
            for (const index of changed) {
                if (index >= view.state.doc.lines) continue
                const line = view.state.doc.line(index + 1)
                const p = pos(line.from)
                if (!p) continue
                const mark = document.createElement('div')
                mark.className = 'viewer-changed-line'
                mark.style.top = `${p.top}px`
                mark.style.height = `${p.bottom - p.top}px`
                overlay.append(mark)
            }
        }
        if (cursor !== null) {
            const p = pos(Math.min(cursor, view.state.doc.length))
            if (p) {
                const marker = document.createElement('div')
                marker.className = 'viewer-cursor'
                marker.style.top = `${p.top}px`
                marker.style.height = `${p.bottom - p.top}px`
                marker.style.left = `${p.left}px`
                overlay.append(marker)
                // Only scroll the editor and its panel, never the window
                revealIn(view.scrollDOM, marker)
                revealIn(view.dom.closest('.panel-content'), marker)
            }
        }
    }

    return {
        dom: view.dom,
        update(code, compareCode = null, cursor = null) {
            const boundedCursor =
                cursor === null
                    ? null
                    : Math.max(0, Math.min(code.length, cursor))
            current = { code, compareCode, cursor: boundedCursor }
            if (view.state.doc.toString() !== code) {
                view.dispatch({
                    changes: {
                        from: 0,
                        to: view.state.doc.length,
                        insert: code,
                    },
                })
            }
            // Positions can only be measured after layout
            requestAnimationFrame(drawOverlay)
        },
    }
}
