import {
    StrudelMirror,
    codemirrorSettings,
    defaultSettings,
} from '@strudel/codemirror'
import { silence } from '@strudel/core'
import { getDrawContext } from '@strudel/draw'
import { transpiler } from '@strudel/transpiler'
import {
    getAudioContext,
    initAudioOnFirstClick,
    webaudioOutput,
} from '@strudel/webaudio'

import { mergeEditorText } from './merge.js'
import { prebake } from './prebake.js'
import { createCodeSync } from './sync.js'
import { createViewer } from './viewer.js'

defaultSettings.isAutoCompletionEnabled = true
defaultSettings.isLineWrappingEnabled = true
defaultSettings.isBracketMatchingEnabled = true

// Redirect soundfont data requests to locally bundled files (public/sounds/).
// The @strudel/repl pre-built chunk has its own copy of fontloader.mjs with a
// separate soundfontUrl variable, so patching globalThis.fetch is the only
// reliable way to redirect those fetches regardless of module instance.
const nativeFetch = globalThis.fetch.bind(globalThis)
const SOUNDFONT_BASE = 'https://felixroos.github.io/webaudiofontdata/sound/'
globalThis.fetch = function (url, init) {
    if (typeof url === 'string' && url.startsWith(SOUNDFONT_BASE)) {
        url = '/sounds/' + url.slice(SOUNDFONT_BASE.length)
    }
    return nativeFetch(url, init)
}

const DEFAULT_CODE = `setcps(1)
n("<0 1 2 3 4>*8").scale('G4 minor')
.s("gm_lead_6_voice")
.clip(sine.range(.2,.8).slow(8))
.jux(rev)
.room(2)
.sometimes(add(note("12")))
.lpf(perlin.range(200,20000).slow(4))`

initAudioOnFirstClick()

const drawContext = getDrawContext()
const drawTime = [-2, 2]
/** @type {string | null} */
let evaluatedCode = null
/** @type {[number, number][]} */
let evaluatedMiniLocations = []
/** @type {{ isActive: (time: number) => boolean }[]} */
let visibleHaps = []
let highlightTime = 0

const mirror = new StrudelMirror({
    defaultOutput: webaudioOutput,
    getTime: () => getAudioContext().currentTime,
    transpiler,
    root: document.getElementById('editor-root'),
    initialCode: DEFAULT_CODE,
    pattern: silence,
    drawTime,
    drawContext,
    prebake,
    solo: true,
    sync: false,
    // Only code that evaluated successfully is shared with peers
    /**
     * @param {{
     *     code: string
     *     meta?: { miniLocations?: [number, number][] }
     * }} options
     */
    afterEval: ({ code, meta }) => {
        evaluatedCode = code
        evaluatedMiniLocations = meta?.miniLocations ?? []
        if (!applyingRemote) codeSync.publish(code, cursorPos())
        if (latestRunning?.code === code) {
            const viewer = getViewer('running', runningContent)
            viewer.updatePatternLocations(evaluatedMiniLocations)
        }
    },
    /**
     * @param {{ isActive: (time: number) => boolean }[]} haps
     * @param {number} time
     * @param {((...args: unknown[]) => void)[]} painters
     */
    onDraw: (haps, time, painters) => {
        painters?.forEach((painter) =>
            painter(drawContext, time, haps, drawTime)
        )
        visibleHaps = haps.filter((hap) => hap.isActive(time))
        highlightTime = time
        if (latestRunning?.code === evaluatedCode) {
            getViewer('running', runningContent).highlight(visibleHaps, time)
        }
    },
    /** @param {boolean} started */
    onToggle: (started) => {
        if (started) return
        visibleHaps = []
        highlightTime = 0
        viewers.get('running')?.clearPatternHighlights()
    },
    onUpdateState: ({ started, error, isDirty }) => {
        updateToolbarState(started, error, isDirty)
        renderEditorState()
    },
})

// Restore saved settings
const savedSettings = codemirrorSettings.get()
mirror.updateSettings(savedSettings)
syncSettingsPanel(savedSettings)

// ── Toolbar wiring ───────────────────────────────────────────────────────────

const playBtn = document.getElementById('play-btn')
const updateBtn = document.getElementById('update-btn')
const settingsBtn = document.getElementById('settings-btn')
const settingsPanel = document.getElementById('settings-panel')
const statusText = document.getElementById('status-text')
const sharedNotice = document.getElementById('shared-notice')

playBtn.addEventListener('click', () => mirror.toggle())
updateBtn.addEventListener('click', () => mirror.evaluate())

settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('open')
})

// Close settings panel when clicking outside
document.addEventListener('click', (e) => {
    if (!settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) {
        settingsPanel.classList.remove('open')
    }
})

function updateToolbarState(started, error, isDirty) {
    const playIcon = document.getElementById('play-icon')
    const stopIcon = document.getElementById('stop-icon')

    if (started) {
        playBtn.classList.add('playing')
        playIcon.style.display = 'none'
        stopIcon.style.display = ''
    } else {
        playBtn.classList.remove('playing')
        playIcon.style.display = ''
        stopIcon.style.display = 'none'
    }

    updateBtn.disabled = !(started && isDirty)

    if (error) {
        statusText.textContent = String(error).replace(/^Error:\s*/i, '')
        statusText.classList.add('error')
    } else {
        statusText.textContent = ''
        statusText.classList.remove('error')
    }
}

// ── Settings panel wiring ────────────────────────────────────────────────────

function syncSettingsPanel(settings) {
    document.getElementById('font-size-input').value = settings.fontSize ?? 18
    document.getElementById('font-size-label').textContent =
        settings.fontSize ?? 18
    document.getElementById('font-family-input').value =
        settings.fontFamily ?? 'monospace'
    document.getElementById('line-numbers-input').checked =
        settings.isLineNumbersDisplayed !== false
    document.getElementById('line-wrap-input').checked =
        settings.isLineWrappingEnabled === true
    document.getElementById('autocomplete-input').checked =
        settings.isAutoCompletionEnabled === true
    document.getElementById('bracket-matching-input').checked =
        settings.isBracketMatchingEnabled === true
    document.getElementById('flash-input').checked =
        settings.isFlashEnabled !== false
    document.getElementById('pattern-highlight-input').checked =
        settings.isPatternHighlightingEnabled !== false
    document.getElementById('tooltip-enabled-input').checked =
        settings.isTooltipEnabled === true
}

function applySetting(key, value) {
    mirror.changeSetting(key, value)
    const updated = { ...codemirrorSettings.get(), [key]: value }
    codemirrorSettings.set(updated)
    if (key === 'isPatternHighlightingEnabled') {
        const viewer = viewers.get('running')
        viewer?.destroy()
        viewers.delete('running')
        if (latestRunning) {
            const runningViewer = getViewer('running', runningContent)
            runningViewer.update(latestRunning.code)
            if (latestRunning.code === evaluatedCode) {
                runningViewer.updatePatternLocations(evaluatedMiniLocations)
                runningViewer.highlight(visibleHaps, highlightTime)
            }
        }
    }
}

document.getElementById('font-size-input').addEventListener('input', (e) => {
    const size = Number(e.target.value)
    document.getElementById('font-size-label').textContent = size
    applySetting('fontSize', size)
})

document.getElementById('font-family-input').addEventListener('change', (e) => {
    applySetting('fontFamily', e.target.value)
})

document
    .getElementById('line-numbers-input')
    .addEventListener('change', (e) => {
        applySetting('isLineNumbersDisplayed', e.target.checked)
    })

document.getElementById('line-wrap-input').addEventListener('change', (e) => {
    applySetting('isLineWrappingEnabled', e.target.checked)
})

document
    .getElementById('autocomplete-input')
    .addEventListener('change', (e) => {
        applySetting('isAutoCompletionEnabled', e.target.checked)
    })

document
    .getElementById('bracket-matching-input')
    .addEventListener('change', (e) => {
        applySetting('isBracketMatchingEnabled', e.target.checked)
    })

document.getElementById('flash-input').addEventListener('change', (e) => {
    applySetting('isFlashEnabled', e.target.checked)
})

document
    .getElementById('pattern-highlight-input')
    .addEventListener('change', (e) => {
        applySetting('isPatternHighlightingEnabled', e.target.checked)
    })

document
    .getElementById('tooltip-enabled-input')
    .addEventListener('change', (e) => {
        applySetting('isTooltipEnabled', e.target.checked)
    })

// ── Shared views (editor / running / peers) ──────────────────────────────────

const editorState = document.getElementById('editor-state')
const runningContent = document.getElementById('running-content')
const runningMeta = document.getElementById('running-meta')
const peersContent = document.getElementById('peers-content')
const tabsBar = document.querySelector('.mobile-shared-tabs')
const sharedViews = document.querySelector('.shared-views')
const runningTab = tabsBar.querySelector('[data-panel="running"]')

tabsBar.addEventListener('click', (event) => {
    const tab = event.target.closest('.tab')
    if (!tab) return
    for (const t of tabsBar.querySelectorAll('.tab')) {
        t.classList.toggle('active', t === tab)
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false')
    }
    const isRunning = tab.dataset.panel === 'running'
    document
        .getElementById('running-panel')
        .classList.toggle('mobile-active', isRunning)
    document
        .getElementById('peers-panel')
        .classList.toggle('mobile-active', !isRunning)
    if (!isRunning && tab.dataset.peer) {
        selectedPeerFrom = tab.dataset.peer
        const entry = peerCards.get(tab.dataset.peer)
        if (entry) peersContent.replaceChildren(entry.card)
    }
})

function shortAddress(addr) {
    return addr.length > 12 ? `${addr.slice(0, 7)}…${addr.slice(-3)}` : addr
}

const viewers = new Map()

function getViewer(key, container) {
    let viewer = viewers.get(key)
    if (!viewer || !container.contains(viewer.dom)) {
        container.replaceChildren()
        viewer = createViewer(container)
        viewers.set(key, viewer)
    }
    return viewer
}

function emptyState(text) {
    const div = document.createElement('div')
    div.className = 'empty-state'
    div.textContent = text
    return div
}

let latestRunning = null

function renderEditorState() {
    const running = latestRunning
    if (!running) {
        editorState.textContent = 'Not run yet'
        editorState.classList.remove('draft')
        return
    }
    const differs = mirror.code !== running.code
    editorState.textContent = differs ? 'Draft differs' : 'Matches running'
    editorState.classList.toggle('draft', differs)
}

const peerCards = new Map()
let orderedPeerIds = []
let selectedPeerFrom = null

function updatePeerLayout(peerCount) {
    const wideLayout = window.matchMedia(
        '(min-width: 560px) and (min-aspect-ratio: 6/5)'
    ).matches
    const availableColumns = Math.min(
        3,
        Math.floor((peersContent.clientWidth + 8) / 288)
    )
    const showGrid =
        wideLayout && peerCount > 0 && peerCount <= availableColumns
    peersContent.classList.toggle('peer-grid', showGrid)
    peersContent.classList.toggle('peer-tabs-mode', !showGrid)
    document
        .getElementById('workspace')
        .classList.toggle('peer-tabs-mode', !showGrid && peerCount > 0)
    sharedViews.classList.toggle(
        'peer-tabs-mode',
        !showGrid && peerCount > 0
    )
    tabsBar.hidden = showGrid && peerCount > 0
    if (peerCount) {
        const cards = orderedPeerIds
            .map((id) => peerCards.get(id)?.card)
            .filter(Boolean)
        const visibleCards = showGrid
            ? cards
            : [
                  peerCards.get(selectedPeerFrom)?.card ??
                      peerCards.get(orderedPeerIds[0])?.card,
              ].filter(Boolean)
        if (
            visibleCards.length !== peersContent.children.length ||
            visibleCards.some(
                (card, index) => peersContent.children[index] !== card
            )
        ) {
            peersContent.replaceChildren(...visibleCards)
        }
    }
}

new ResizeObserver(() => updatePeerLayout(peerCards.size)).observe(peersContent)
window.addEventListener('resize', () => updatePeerLayout(peerCards.size))

function renderShared({ running, peers }) {
    latestRunning = running
    const self = window.webxdc.selfAddr

    if (running) {
        runningMeta.textContent =
            running.from === self
                ? 'by you'
                : `by ${running.name || shortAddress(running.from)}`
        const viewer = getViewer('running', runningContent)
        viewer.update(running.code)
        if (running.code !== evaluatedCode) {
            viewer.clearPatternHighlights()
        }
    } else {
        runningMeta.textContent = ''
        viewers.delete('running')
        runningContent.replaceChildren(
            emptyState('Code that plays successfully is shared here.')
        )
    }

    const others = [...peers.values()]
        .filter((p) => p.from !== self)
    orderedPeerIds = others.map((peer) => peer.from)
    selectedPeerFrom =
        [...others].sort((a, b) => b.ts - a.ts || b.id.localeCompare(a.id))[0]
            ?.from ?? null
    document
        .getElementById('workspace')
        .classList.toggle('solo', others.length === 0)
    tabsBar.replaceChildren(runningTab)
    if (!others.length) {
        peerCards.clear()
        viewers.forEach(
            (_, key) => key.startsWith('peer:') && viewers.delete(key)
        )
        peersContent.replaceChildren(
            emptyState("Peers' drafts will appear here as they type.")
        )
        const emptyTab = document.createElement('button')
        emptyTab.className = 'tab active'
        emptyTab.type = 'button'
        emptyTab.setAttribute('role', 'tab')
        emptyTab.dataset.panel = 'peers'
        emptyTab.textContent = 'Peers'
        emptyTab.setAttribute('aria-selected', 'true')
        runningTab.classList.remove('active')
        runningTab.setAttribute('aria-selected', 'false')
        document
            .getElementById('running-panel')
            .classList.remove('mobile-active')
        document.getElementById('peers-panel').classList.add('mobile-active')
        tabsBar.append(emptyTab)
    }
    for (const peer of others) {
        let entry = peerCards.get(peer.from)
        if (!entry) {
            const card = document.createElement('article')
            card.className = 'peer-card'
            const heading = document.createElement('div')
            heading.className = 'peer-heading'
            const name = document.createElement('strong')
            const body = document.createElement('div')
            heading.append(name)
            card.append(heading, body)
            entry = { card, name, body }
            peerCards.set(peer.from, entry)
        }
        entry.name.textContent = peer.name || shortAddress(peer.from)
        const peerTab = document.createElement('button')
        peerTab.className = 'tab'
        if (peer.from === selectedPeerFrom) peerTab.classList.add('active')
        peerTab.type = 'button'
        peerTab.setAttribute('role', 'tab')
        peerTab.dataset.panel = 'peer'
        peerTab.dataset.peer = peer.from
        peerTab.textContent = peer.name || shortAddress(peer.from)
        peerTab.setAttribute(
            'aria-selected',
            peer.from === selectedPeerFrom ? 'true' : 'false'
        )
        tabsBar.append(peerTab)
        getViewer(`peer:${peer.from}`, entry.body).update(
            peer.code,
            running?.code ?? null,
            peer.cursor
        )
    }
    if (others.length) {
        document
            .getElementById('running-panel')
            .classList.remove('mobile-active')
        document.getElementById('peers-panel').classList.add('mobile-active')
        runningTab.classList.remove('active')
        runningTab.setAttribute('aria-selected', 'false')
        updatePeerLayout(others.length)
    } else {
        orderedPeerIds = []
        selectedPeerFrom = null
        updatePeerLayout(0)
    }
    renderEditorState()
}

// ── WebXDC integration ───────────────────────────────────────────────────────

let noticeTimeout
function showSharedNotice() {
    sharedNotice.classList.add('show')
    clearTimeout(noticeTimeout)
    noticeTimeout = setTimeout(
        () => sharedNotice.classList.remove('show'),
        3000
    )
}

// Code last known to be running. Local edits are merged against it so they
// are never overwritten by an incoming snapshot.
let baseCode = DEFAULT_CODE
let applyingRemote = false

// Local undo history: the last few local changes, then the running code.
// Remote and undo-driven changes are not recorded.
const UNDO_STEPS = 3
const UNDO_GROUP_MS = 750
let undoHistory = []
let lastChangeAt = 0
let silent = false
let trackedCode = mirror.code
Object.defineProperty(mirror, 'code', {
    get: () => trackedCode,
    set(value) {
        if (!silent && value !== trackedCode) {
            const now = Date.now()
            if (now - lastChangeAt > UNDO_GROUP_MS) {
                undoHistory.push(trackedCode)
                if (undoHistory.length > UNDO_STEPS) undoHistory.shift()
            }
            lastChangeAt = now
        }
        trackedCode = value
    },
})

function setCodeSilently(code) {
    silent = true
    try {
        mirror.setCode(code)
    } finally {
        silent = false
    }
    undoHistory = []
}

function undoLocal() {
    const target = undoHistory.pop() ?? latestRunning?.code
    if (target === undefined || target === mirror.code) return
    silent = true
    try {
        mirror.setCode(target)
    } finally {
        silent = false
    }
    lastChangeAt = 0
}

document.addEventListener(
    'keydown',
    (e) => {
        if (!(e.metaKey || e.ctrlKey) || e.altKey) return
        const key = e.key.toLowerCase()
        if (key === 's' && !e.shiftKey) {
            e.preventDefault()
            e.stopPropagation()
            if (!updateBtn.disabled || !mirror.repl.scheduler.started) {
                mirror.evaluate()
            }
        } else if (
            key === 'z' &&
            !e.shiftKey &&
            e.target instanceof Element &&
            e.target.closest('#editor-root')
        ) {
            e.preventDefault()
            e.stopPropagation()
            undoLocal()
        }
    },
    true
)

async function onSharedChange(state) {
    const { running } = state
    renderShared(state)
    if (!running || running.code === baseCode) return
    const previous = baseCode
    baseCode = running.code
    const local = mirror.code
    const merged = mergeEditorText(previous, local, running.code)
    if (merged !== local) setCodeSilently(merged)
    // Follow along live only when the editor has no local changes of its own
    const isOwn = running.from === window.webxdc.selfAddr
    if (!isOwn && merged === running.code && mirror.repl.scheduler.started) {
        applyingRemote = true
        try {
            await mirror.evaluate()
        } finally {
            applyingRemote = false
        }
    } else if (merged !== local) {
        showSharedNotice()
    }
    renderEditorState()
}

const codeSync = createCodeSync(onSharedChange)
renderShared(codeSync.state)

function cursorPos() {
    return mirror.editor.state.selection.main.head
}

// Share the in-progress draft and cursor (display only; never evaluated)
let sentDraft = null
function shareDraft() {
    const draft = { code: mirror.code, cursor: cursorPos() }
    if (sentDraft?.code === draft.code && sentDraft.cursor === draft.cursor) {
        return
    }
    sentDraft = draft
    codeSync.publishDraft(draft.code, draft.cursor)
    renderEditorState()
}

// Start from the synced running code instead of the default. Drafts are only
// shared once history has replayed.
codeSync.ready.then(() => {
    const { running } = codeSync.state
    const target = running
    if (target && mirror.code === DEFAULT_CODE && target.code !== mirror.code) {
        setCodeSilently(target.code)
        baseCode = running?.code ?? baseCode
    }
    renderEditorState()
    setInterval(shareDraft, 300)
})
