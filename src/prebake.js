import { evalScope } from '@strudel/core'
import * as core from '@strudel/core'
import {
    registerSynthSounds,
    registerZZFXSounds,
    samples,
} from '@strudel/webaudio'

const DRUM_SAMPLES = {
    bd: '/sounds/drums/bd.wav',
    sd: '/sounds/drums/sd.wav',
    hh: '/sounds/drums/hh.wav',
    oh: '/sounds/drums/oh.wav',
    cp: '/sounds/drums/cp.wav',
}

/**
 * Offline-safe prebake for the webxdc sandbox.
 *
 * Equivalent to the `prebake` from `@strudel/repl`, but omits all external
 * network calls (`aliasBank(...)`) that would fail when the webxdc sandbox has
 * no internet access. A small drum kit is bundled locally and registered
 * below.
 *
 * The GM soundfont sounds are handled separately via the `soundfonts` Vite
 * plugin (which downloads them at build time) and the `globalThis.fetch` patch
 * in `index.js` (which redirects the runtime fetches to `/sounds/`).
 */
export async function prebake() {
    const modulesLoading = evalScope(
        core,
        import('@strudel/draw'),
        import('@strudel/mini'),
        import('@strudel/tonal'),
        import('@strudel/webaudio'),
        import('@strudel/codemirror'),
        import('@strudel/soundfonts'),
        import('@strudel/transpiler')
    )

    await Promise.all([
        modulesLoading,
        registerSynthSounds(),
        registerZZFXSounds(),
        samples(DRUM_SAMPLES),
        import('@strudel/soundfonts').then(({ registerSoundfonts }) =>
            registerSoundfonts()
        ),
    ])
}
