import '@strudel/repl'

window.webxdc.setUpdateListener((_update) => {})

// Wait for the strudel-editor custom element to be defined and connected before
// wiring up our own toolbar buttons.
customElements.whenDefined('strudel-editor').then(() => {
    const strudelEl = document.querySelector('strudel-editor')
    if (!strudelEl || !strudelEl.parentElement) return

    // Build a simple toolbar with play / stop buttons.
    const toolbar = document.createElement('div')
    toolbar.id = 'strudel-toolbar'
    const btnPlay = document.createElement('button')
    btnPlay.id = 'btn-play'
    btnPlay.title = 'Play (Ctrl+Enter)'
    btnPlay.textContent = '▶ Play'
    const btnStop = document.createElement('button')
    btnStop.id = 'btn-stop'
    btnStop.title = 'Stop (Ctrl+.)'
    btnStop.textContent = '■ Stop'
    toolbar.append(btnPlay, btnStop)
    strudelEl.parentElement.insertBefore(toolbar, strudelEl)

    // Keep button enabled state in sync with the repl's running state.
    const updateButtons = (/** @type {boolean} */ started) => {
        btnPlay.disabled = started
        btnStop.disabled = !started
    }
    updateButtons(false)

    strudelEl.addEventListener('update', (e) => {
        updateButtons(
            /** @type {CustomEvent<{ started: boolean }>} */ (e).detail.started
        )
    })

    // Use a short delay so the editor object is fully initialised before we
    // attach click handlers.
    setTimeout(() => {
        const el =
            /** @type {{ editor?: { evaluate(): void; stop(): void } }} */ (
                /** @type {unknown} */ (strudelEl)
            )
        btnPlay.addEventListener('click', () => el.editor?.evaluate())
        btnStop.addEventListener('click', () => el.editor?.stop())
    }, 0)
})
