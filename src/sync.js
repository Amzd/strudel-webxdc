// Shares successfully evaluated code between peers over two channels:
//  - realtime (webxdc.joinRealtimeChannel) for instant delivery to online peers
//  - status updates (webxdc.sendUpdate) so offline peers catch up later
// Two message types: 'compiled' (code that played successfully; becomes the
// shared running code; sent over realtime and updates) and 'draft' (a peer's
// work in progress, display only; realtime only, never stored in history).
// Every message has a unique id, so copies arriving over both channels (or
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
            (msg.type !== 'draft' && msg.type !== 'compiled') ||
            seen.has(msg.id)
        ) {
            return
        }
        seen.add(msg.id)
        const snap = {
            id: msg.id,
            type: msg.type,
            code: msg.code,
            cursor: Number.isFinite(msg.cursor) ? msg.cursor : null,
            ts: msg.ts,
            from: msg.from,
            name: typeof msg.name === 'string' ? msg.name : '',
        }
        let changed = false
        if (isNewer(snap, state.peers.get(snap.from))) {
            state.peers.set(snap.from, snap)
            changed = true
        }
        if (snap.type === 'compiled' && isNewer(snap, state.running)) {
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

    // Resolves once the stored history has been replayed
    const ready = wx.setUpdateListener((update) => {
        // Drafts are realtime-only; ignore any that were stored as updates
        if (update.payload?.type === 'compiled') receive(update.payload)
    })

    let lastOwnTs = 0
    const nextTs = () => (lastOwnTs = Math.max(Date.now(), lastOwnTs + 1))

    function send(type, code, cursor) {
        const msg = {
            id: `${wx.selfAddr}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            type,
            code,
            cursor,
            ts:
                type === 'compiled'
                    ? Math.max(nextTs(), (state.running?.ts ?? 0) + 1)
                    : nextTs(),
            from: wx.selfAddr,
            name: wx.selfName,
        }
        lastOwnTs = Math.max(lastOwnTs, msg.ts)
        receive(msg)
        return msg
    }

    function sendRealtime(msg) {
        try {
            realtime?.send(encoder.encode(JSON.stringify(msg)))
        } catch (e) {
            console.warn('realtime send failed', e)
        }
    }

    return {
        state,
        ready,
        /** @param {string} code @param {number} cursor */
        publishDraft(code, cursor) {
            const msg = send('draft', code, cursor)
            sendRealtime(msg)
        },
        /** @param {string} code Code that just evaluated successfully */
        publish(code, cursor) {
            const msg = send('compiled', code, cursor)
            sendRealtime(msg)
            wx.sendUpdate({ payload: msg }, '')
        },
    }
}
