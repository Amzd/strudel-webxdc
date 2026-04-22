import { StrudelMirror, codemirrorSettings } from '@strudel/codemirror'
import { silence } from '@strudel/core'
import { getDrawContext } from '@strudel/draw'
import { transpiler } from '@strudel/transpiler'
import {
    getAudioContext,
    initAudioOnFirstClick,
    webaudioOutput,
} from '@strudel/webaudio'

import { prebake } from './prebake.js'

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
    onUpdateState: ({ started, error, isDirty }) => {
        updateToolbarState(started, error, isDirty)
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
    document.getElementById('tooltip-input').checked =
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

document.getElementById('tooltip-input').addEventListener('change', (e) => {
    applySetting('isTooltipEnabled', e.target.checked)
})

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

window.webxdc.setUpdateListener((update) => {
    const code = update.payload?.code
    if (typeof code === 'string' && code !== mirror.code) {
        mirror.setCode(code)
        showSharedNotice()
    }
})
