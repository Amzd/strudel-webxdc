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

import { changedLineIndexes, mergeEditorText } from './merge.js'
import { prebake } from './prebake.js'
import { createCodeSync } from './sync.js'

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
    afterEval: ({ code }) => {
        if (!applyingRemote) codeSync.publish(code)
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
const peersTitle = document.getElementById('peers-title')
const tabs = document.querySelectorAll('.mobile-shared-tabs .tab')

for (const tab of tabs) {
    tab.addEventListener('click', () => {
        for (const t of tabs) t.classList.toggle('active', t === tab)
        document
            .getElementById('running-panel')
            .classList.toggle('mobile-active', tab.dataset.panel === 'running')
        document
            .getElementById('peers-panel')
            .classList.toggle('mobile-active', tab.dataset.panel === 'peers')
    })
}

function shortAddress(addr) {
    return addr.length > 12 ? `${addr.slice(0, 7)}…${addr.slice(-3)}` : addr
}

function renderCode(container, code, compareCode) {
    container.replaceChildren()
    if (!code) {
        container.textContent = 'Empty source'
        return
    }
    const changed =
        typeof compareCode === 'string'
            ? changedLineIndexes(compareCode, code)
            : new Set()
    const pre = document.createElement('pre')
    pre.className = 'source-code'
    code.split('\n').forEach((line, index) => {
        const span = document.createElement('span')
        span.className = changed.has(index)
            ? 'source-line changed-line'
            : 'source-line'
        span.textContent = line || ' '
        pre.append(span)
    })
    container.append(pre)
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

function renderShared({ running, peers }) {
    latestRunning = running
    const self = window.webxdc.selfAddr

    if (running) {
        runningMeta.textContent =
            running.from === self
                ? 'by you'
                : `by ${running.name || shortAddress(running.from)}`
        renderCode(runningContent, running.code, null)
    } else {
        runningMeta.textContent = ''
        runningContent.replaceChildren(
            emptyState('Code that plays successfully is shared here.')
        )
    }

    const others = [...peers.values()]
        .filter((p) => p.from !== self)
        .sort((a, b) => a.from.localeCompare(b.from))
    peersTitle.textContent = `Peers · ${others.length}`
    tabs[1].textContent = peersTitle.textContent
    peersContent.replaceChildren()
    if (!others.length) {
        peersContent.append(
            emptyState("Peers' last playing code will appear here.")
        )
    }
    for (const peer of others) {
        const card = document.createElement('article')
        card.className = 'peer-card'
        const heading = document.createElement('div')
        heading.className = 'peer-heading'
        const name = document.createElement('strong')
        name.textContent = peer.name || shortAddress(peer.from)
        heading.append(name)
        const body = document.createElement('div')
        renderCode(body, peer.code, running?.code)
        card.append(heading, body)
        peersContent.append(card)
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

async function onSharedChange(state) {
    const { running } = state
    renderShared(state)
    if (!running || running.code === baseCode) return
    const previous = baseCode
    baseCode = running.code
    const local = mirror.code
    const merged = mergeEditorText(previous, local, running.code)
    if (merged !== local) mirror.setCode(merged)
    // Follow along live only when the editor has no local changes of its own
    if (merged === running.code && mirror.repl.scheduler.started) {
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
