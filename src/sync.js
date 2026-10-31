// Shares successfully evaluated code between peers over two channels:
//  - realtime (webxdc.joinRealtimeChannel) for instant delivery to online peers
//  - status updates (webxdc.sendUpdate) so offline peers catch up later
// Every snapshot has a unique id, so copies arriving over both channels (or
// echoed back to the sender) are applied only once.

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * @typedef {{
 *     id: string
 *     code: string
 *     ts: number
 *     from: string
 *     name: string
 * }} Snapshot
 */

/**
 * @param {(state: {
 *     running: Snapshot | null
 *     peers: Map<string, Snapshot>
 * }) => void} onChange
 */
export function createCodeSync(onChange) {
    const wx = window.webxdc
    const seen = new Set()
    const state = {
        /** Newest snapshot overall */
        running: /** @type {Snapshot | null} */ (null),
        /** Newest snapshot per sender */
        peers: /** @type {Map<string, Snapshot>} */ (new Map()),
    }

    const isNewer = (a, b) =>
        !b || a.ts > b.ts || (a.ts === b.ts && a.id > b.id)

    function receive(msg) {
        if (
            typeof msg?.id !== 'string' ||
            typeof msg.code !== 'string' ||
            typeof msg.ts !== 'number' ||
            typeof msg.from !== 'string' ||
            seen.has(msg.id)
        ) {
            return
        }
        seen.add(msg.id)
        const snap = {
            id: msg.id,
            code: msg.code,
            ts: msg.ts,
            from: msg.from,
            name: typeof msg.name === 'string' ? msg.name : '',
        }
        let changed = false
        if (isNewer(snap, state.peers.get(snap.from))) {
            state.peers.set(snap.from, snap)
            changed = true
        }
        if (isNewer(snap, state.running)) {
            state.running = snap
            changed = true
        }
        if (changed) onChange(state)
    }

    let realtime = null
    try {
        realtime = wx.joinRealtimeChannel?.() ?? null
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

    wx.setUpdateListener((update) => receive(update.payload))

    return {
        state,
        /** @param {string} code Code that just evaluated successfully */
        publish(code) {
            const msg = {
                id: `${wx.selfAddr}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
                code,
                ts: Math.max(Date.now(), (state.running?.ts ?? 0) + 1),
                from: wx.selfAddr,
                name: wx.selfName,
            }
            receive(msg)
            try {
                realtime?.send(encoder.encode(JSON.stringify(msg)))
            } catch (e) {
                console.warn('realtime send failed', e)
            }
            wx.sendUpdate({ payload: msg }, '')
        },
    }
}
