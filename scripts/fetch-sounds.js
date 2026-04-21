/**
 * Downloads General MIDI soundfont JS files from webaudiofontdata so they can
 * be served locally inside the webxdc zip (no network access at runtime).
 *
 * Runs automatically as part of `pnpm run build`. The output files land in
 * `public/sounds/` which Vite copies into `dist/` verbatim.
 *
 * Only the first font variant for each GM sound is downloaded. That is enough
 * for single-`n` patterns; the extras are alternative renditions of the same
 * instrument. The default pattern cycles n=0..4 so all six variants of
 * gm_lead_6_voice are also fetched.
 */

import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { get } from 'node:https'
import { resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const SOUNDS_DIR = resolve(__dirname, '../public/sounds')
const BASE_URL = 'https://felixroos.github.io/webaudiofontdata/sound'
const CONCURRENCY = 8

if (!existsSync(SOUNDS_DIR)) {
    mkdirSync(SOUNDS_DIR, { recursive: true })
}

// ---------- resolve the font list from @strudel/soundfonts ----------------

const { default: gm } = await import('@strudel/soundfonts/gm.mjs')

/**
 * Build the list of font file names to download.
 *
 * - One variant (the first listed) per GM sound — covers the GM instrument set
 *   registered by @strudel/soundfonts (a subset of the 128 GM patches).
 * - ALL variants for gm_lead_6_voice because the default demo pattern cycles
 *   through n=0..4 which maps to font indices 0..4 of that sound.
 */
const FULL_VARIANTS = new Set(['gm_lead_6_voice'])

const toDownload = new Set()
for (const [soundName, fonts] of Object.entries(gm)) {
    if (FULL_VARIANTS.has(soundName)) {
        fonts.forEach((f) => toDownload.add(f))
    } else {
        toDownload.add(fonts[0])
    }
}

const files = [...toDownload]
console.log(`Fetching ${files.length} soundfont files into public/sounds/ …`)

// ---------- download helpers -----------------------------------------------

function download(fileName) {
    const dest = resolve(SOUNDS_DIR, fileName + '.js')
    if (existsSync(dest)) return Promise.resolve() // already cached
    const url = `${BASE_URL}/${fileName}.js`
    return new Promise((resolve, reject) => {
        get(url, (res) => {
            if (res.statusCode !== 200) {
                res.resume()
                reject(new Error(`HTTP ${res.statusCode} for ${url}`))
                return
            }
            const stream = createWriteStream(dest)
            pipeline(res, stream).then(resolve).catch(reject)
        }).on('error', reject)
    })
}

async function runWithConcurrency(tasks, limit) {
    let idx = 0
    let done = 0
    let failed = 0
    const total = tasks.length
    async function worker() {
        while (idx < tasks.length) {
            const task = tasks[idx++]
            try {
                await task()
            } catch (err) {
                failed++
                if (failed <= 3) {
                    console.warn(`  Warning: ${err.message}`)
                } else if (failed === 4) {
                    console.warn('  (further download errors suppressed)')
                }
            }
            done++
            if (done % 20 === 0 || done === total) {
                process.stdout.write(`  ${done}/${total}\r`)
            }
        }
    }
    await Promise.all(Array.from({ length: limit }, worker))
    process.stdout.write('\n')
    if (failed > 0) {
        console.warn(
            `Warning: ${failed} of ${total} soundfont files could not be downloaded.` +
                ' GM sounds may not work offline.'
        )
    }
}

await runWithConcurrency(
    files.map((f) => () => download(f)),
    CONCURRENCY
)

console.log('Done.')
