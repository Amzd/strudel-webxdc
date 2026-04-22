import { evalScope } from '@strudel/core'
import * as core from '@strudel/core'
import { registerSynthSounds, registerZZFXSounds } from '@strudel/webaudio'

/**
 * Offline-safe prebake for the webxdc sandbox.
 *
 * Equivalent to the `prebake` from `@strudel/repl`, but omits all external
 * network calls (`samples(...)` and `aliasBank(...)`) that would fail when the
 * webxdc sandbox has no internet access.
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
        import('@strudel/soundfonts').then(({ registerSoundfonts }) =>
            registerSoundfonts()
        ),
    ])
}
