import { prebake as strudelPrebake } from '@strudel/repl'
import { setSoundfontUrl } from '@strudel/soundfonts'

/**
 * Custom prebake that redirects soundfont fetches to our locally bundled copy
 * in `public/sounds/` (served as `/sounds/` at runtime). This makes all GM
 * instrument sounds work inside a webxdc sandbox where external network access
 * is blocked.
 */
export async function prebake() {
    setSoundfontUrl('/sounds')
    await strudelPrebake()
}
