// Syncs code between peers over two channels:
//  - realtime (webxdc.joinRealtimeChannel) for instant delivery to online peers
//  - status updates (webxdc.sendUpdate) so offline peers catch up later
// Each message carries a revision (timestamp + sender); the newest one wins and
// duplicates arriving over both channels are ignored.

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** @param {(code: string) => void} onRemoteCode */
export function createCodeSync(onRemoteCode) {
    const self = window.webxdc.selfAddr
    let latest = { ts: 0, from: '' }
    let realtime = null

    const isNewer = (ts, from) =>
        ts > latest.ts || (ts === latest.ts && from > latest.from)

    function receive(msg) {
        if (
            typeof msg?.code !== 'string' ||
            typeof msg.ts !== 'number' ||
            typeof msg.from !== 'string' ||
            !isNewer(msg.ts, msg.from)
        ) {
            return
        }
        latest = { ts: msg.ts, from: msg.from }
        onRemoteCode(msg.code)
    }

    try {
        realtime = window.webxdc.joinRealtimeChannel?.() ?? null
        realtime?.setListener((data) => {
            try {
                receive(JSON.parse(decoder.decode(data)))
            } catch {
                // ignore malformed realtime data
            }
        })
    } catch (e) {
        console.warn('realtime channel unavailable', e)
    }

    window.webxdc.setUpdateListener((update) => receive(update.payload))

    const sync = {
        suppressPublish: false,
        /** @param {string} code Code that evaluated successfully */
        publish(code) {
            if (sync.suppressPublish) return
            const msg = {
                code,
                ts: Math.max(Date.now(), latest.ts + 1),
                from: self,
            }
            latest = { ts: msg.ts, from: msg.from }
            try {
                realtime?.send(encoder.encode(JSON.stringify(msg)))
            } catch (e) {
                console.warn('realtime send failed', e)
            }
            window.webxdc.sendUpdate({ payload: msg }, '')
        },
    }
    return sync
}
