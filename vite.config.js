import {
    createWriteStream,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from 'node:fs'
import { get } from 'node:https'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Resvg } from '@resvg/resvg-js'
import { buildXDC, eruda, mockWebxdc } from '@webxdc/vite-plugins'
import { defineConfig } from 'vite'

function svgToPng(svgPath, pngName) {
    return {
        name: 'svg-to-png',
        closeBundle() {
            try {
                const svg = readFileSync(svgPath)
                const resvg = new Resvg(svg, {
                    fitTo: { mode: 'width', value: 512 },
                })
                const png = resvg.render().asPng()
                writeFileSync(resolve('dist', pngName), png)
            } catch (err) {
                throw new Error(
                    `svg-to-png: failed to convert "${svgPath}" to "${pngName}": ${err.message}`
                )
            }
        },
    }
}

/**
 * Downloads General MIDI soundfont JS files from webaudiofontdata into
 * `<publicDir>/sounds/` so they can be served locally inside the webxdc zip.
 *
 * One font variant is downloaded per GM sound. For `gm_lead_6_voice` all
 * variants are fetched because the default pattern cycles n=0..4 across them.
 */
function soundfonts() {
    let publicDir = 'public'
    return {
        name: 'soundfonts',
        configResolved(config) {
            publicDir = config.publicDir
        },
        async buildStart() {
            const soundsDir = join(publicDir, 'sounds')
            if (!existsSync(soundsDir))
                mkdirSync(soundsDir, { recursive: true })

            const { default: gm } = await import('@strudel/soundfonts/gm.mjs')
            const BASE_URL =
                'https://felixroos.github.io/webaudiofontdata/sound'
            const FULL_VARIANTS = new Set(['gm_lead_6_voice'])

            const toDownload = new Set()
            for (const [name, fonts] of Object.entries(gm)) {
                if (FULL_VARIANTS.has(name)) {
                    fonts.forEach((f) => toDownload.add(f))
                } else {
                    toDownload.add(fonts[0])
                }
            }

            let downloaded = 0
            let skipped = 0
            let failed = 0
            for (const fileName of toDownload) {
                const dest = join(soundsDir, `${fileName}.js`)
                if (existsSync(dest)) {
                    skipped++
                    continue
                }
                try {
                    await downloadFile(`${BASE_URL}/${fileName}.js`, dest)
                    downloaded++
                } catch (err) {
                    if (failed < 3) {
                        console.debug(
                            `[soundfonts] could not download ${fileName}: ${err.message}`
                        )
                    }
                    failed++
                }
            }

            if (downloaded > 0 || skipped > 0) {
                console.log(
                    `[soundfonts] ${downloaded} downloaded, ${skipped} cached`
                )
            }
            if (failed > 0) {
                console.warn(
                    `[soundfonts] Warning: ${failed}/${toDownload.size} soundfont files could not be downloaded. GM sounds may not work offline.`
                )
            }
        },
    }
}

function downloadFile(url, dest) {
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

export default defineConfig({
    plugins: [
        buildXDC(),
        eruda(),
        mockWebxdc(),
        soundfonts(),
        svgToPng('src/icon.svg', 'icon.png'),
    ],
})
