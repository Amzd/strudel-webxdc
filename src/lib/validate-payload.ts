/** Metadata for a single track, shared with all peers via realtime state. */
export type TrackMeta = {
	id: string
	filename: string
	size: number
	chunkCount: number
	lastModified: number
	/** Chunk indices still needed; empty when the track is fully available. */
	pending: Array<number>
}

export type AppState = {
	tracks: Array<TrackMeta>
}

export type ChunkRequest = {
	time: number
	trackId: string
	chunkIndex: number
	/** Device ID of the peer that should respond to this request. */
	peer: string
}

export type ChunkResponse = {
	trackId: string
	lastModified: number
	chunkIndex: number
	data: Uint8Array
}

export type AppPayload = { request: ChunkRequest } | { response: ChunkResponse }

export function isChunkRequest(
	payload: unknown
): payload is { request: ChunkRequest } {
	if (typeof payload !== 'object' || payload === null) return false
	const p = payload as Record<string, unknown>
	return typeof p['request'] === 'object' && p['request'] !== null
}

export function isChunkResponse(
	payload: unknown
): payload is { response: ChunkResponse } {
	if (typeof payload !== 'object' || payload === null) return false
	const p = payload as Record<string, unknown>
	return typeof p['response'] === 'object' && p['response'] !== null
}
