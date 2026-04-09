/** One-megabyte chunk size used when splitting tracks for P2P transfer. */
export const CHUNK_SIZE = 1024 * 1024

const DB_NAME = 'mp3player'
const DB_VERSION = 3
const TRACKS_STORE = 'tracks'
const TRACK_META_STORE = 'track_meta'
const CHUNKS_STORE = 'chunks'

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null

/** @returns {Promise<IDBDatabase>} */
function openDB() {
	if (dbPromise) return dbPromise
	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION)
		request.onupgradeneeded = (event) => {
			const db = /** @type {IDBOpenDBRequest} */ (event.target).result
			const oldVersion = event.oldVersion

			if (oldVersion < 1) {
				db.createObjectStore(TRACKS_STORE, { keyPath: 'filename' })
			}
			// Versions 1 and 2 had a pending_chunks store; replace it with the
			// new pull-model stores.
			if (db.objectStoreNames.contains('pending_chunks')) {
				db.deleteObjectStore('pending_chunks')
			}
			if (!db.objectStoreNames.contains(TRACK_META_STORE)) {
				db.createObjectStore(TRACK_META_STORE, { keyPath: 'id' })
			}
			if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
				const chunksStore = db.createObjectStore(CHUNKS_STORE, {
					keyPath: 'key',
				})
				chunksStore.createIndex('by_track', 'trackId')
			}
		}
		request.onsuccess = (event) =>
			resolve(/** @type {IDBOpenDBRequest} */ (event.target).result)
		request.onerror = (event) =>
			reject(/** @type {IDBOpenDBRequest} */ (event.target).error)
	})
	return dbPromise
}

/**
 * @param {IDBRequest} request
 *
 * @returns {Promise<any>}
 */
function promisifyRequest(request) {
	return new Promise((resolve, reject) => {
		request.onsuccess = (event) =>
			resolve(/** @type {IDBRequest} */ (event.target).result)
		request.onerror = (event) =>
			reject(/** @type {IDBRequest} */ (event.target).error)
	})
}

/**
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {'readonly' | 'readwrite'} mode
 *
 * @returns {IDBObjectStore}
 */
function getStore(db, storeName, mode) {
	return db.transaction(storeName, mode).objectStore(storeName)
}

// ── Assembled tracks (for playback) ──────────────────────────────────────────

/**
 * Returns all stored track filenames.
 *
 * @returns {Promise<string[]>}
 */
export async function getAllTrackFilenames() {
	const db = await openDB()
	/** @type {{ filename: string }[]} */
	const records = await promisifyRequest(
		getStore(db, TRACKS_STORE, 'readonly').getAll()
	)
	return records.map((r) => r.filename)
}

/**
 * Returns the assembled blob for the given filename, or null if not stored.
 *
 * @param {string} filename
 *
 * @returns {Promise<Blob | null>}
 */
export async function getTrackBlob(filename) {
	const db = await openDB()
	/** @type {{ filename: string; blob: Blob } | undefined} */
	const record = await promisifyRequest(
		getStore(db, TRACKS_STORE, 'readonly').get(filename)
	)
	return record ? record.blob : null
}

/**
 * Returns true if an assembled track with this filename is already stored.
 *
 * @param {string} filename
 *
 * @returns {Promise<boolean>}
 */
export async function hasTrack(filename) {
	const db = await openDB()
	const record = await promisifyRequest(
		getStore(db, TRACKS_STORE, 'readonly').get(filename)
	)
	return record !== undefined
}

/**
 * Stores an assembled track blob.
 *
 * @param {string} filename
 * @param {Blob} blob
 *
 * @returns {Promise<void>}
 */
export async function storeTrack(filename, blob) {
	const db = await openDB()
	await promisifyRequest(
		getStore(db, TRACKS_STORE, 'readwrite').put({ filename, blob })
	)
}

// ── Track metadata (pull-model realtime state) ────────────────────────────────

/**
 * Returns metadata for all known tracks (uploaded and received, complete and
 * in-progress).
 *
 * @returns {Promise<import('./validate-payload').TrackMeta[]>}
 */
export async function getAllTrackMetas() {
	const db = await openDB()
	return promisifyRequest(getStore(db, TRACK_META_STORE, 'readonly').getAll())
}

/**
 * Returns the metadata record for the given track id, or null.
 *
 * @param {string} id
 *
 * @returns {Promise<import('./validate-payload').TrackMeta | null>}
 */
export async function getTrackMeta(id) {
	const db = await openDB()
	const record = await promisifyRequest(
		getStore(db, TRACK_META_STORE, 'readonly').get(id)
	)
	return record ?? null
}

/**
 * Stores (inserts or replaces) a track metadata record.
 *
 * @param {import('./validate-payload').TrackMeta} meta
 *
 * @returns {Promise<void>}
 */
export async function storeTrackMeta(meta) {
	const db = await openDB()
	await promisifyRequest(getStore(db, TRACK_META_STORE, 'readwrite').put(meta))
}

// ── In-progress download chunks ───────────────────────────────────────────────

/**
 * Stores a received binary chunk.
 *
 * @param {string} trackId
 * @param {number} chunkIndex
 * @param {Blob} blob
 *
 * @returns {Promise<void>}
 */
export async function storeChunkBlob(trackId, chunkIndex, blob) {
	const db = await openDB()
	await promisifyRequest(
		getStore(db, CHUNKS_STORE, 'readwrite').put({
			key: `${trackId}_${chunkIndex}`,
			trackId,
			chunkIndex,
			blob,
		})
	)
}

/**
 * Returns a single chunk blob. First looks in the in-progress chunks store; if
 * not found (e.g. after assembly or for an uploaded track), slices it from the
 * assembled blob. Returns null only when the chunk genuinely cannot be found.
 *
 * @param {string} trackId
 * @param {number} chunkIndex
 * @param {string | null} filename Filename of the assembled blob to fall back
 *   to.
 *
 * @returns {Promise<Blob | null>}
 */
export async function getChunkBlob(trackId, chunkIndex, filename) {
	const db = await openDB()
	/** @type {{ blob: Blob } | undefined} */
	const record = await promisifyRequest(
		getStore(db, CHUNKS_STORE, 'readonly').get(`${trackId}_${chunkIndex}`)
	)
	if (record) return record.blob

	// Fall back to slicing from the assembled blob (uploaded or fully received tracks).
	if (!filename) return null
	const assembled = await getTrackBlob(filename)
	if (!assembled) return null
	const start = chunkIndex * CHUNK_SIZE
	const end = Math.min(start + CHUNK_SIZE, assembled.size)
	return assembled.slice(start, end)
}

/**
 * Deletes all in-progress chunks for a track (called after successful
 * assembly).
 *
 * @param {string} trackId
 *
 * @returns {Promise<void>}
 */
export async function deleteTrackChunks(trackId) {
	const db = await openDB()
	// Read phase: use a readonly transaction to collect all keys for this track.
	const index = db
		.transaction(CHUNKS_STORE, 'readonly')
		.objectStore(CHUNKS_STORE)
		.index('by_track')
	/** @type {IDBValidKey[]} */
	const keys = await promisifyRequest(index.getAllKeys(trackId))
	if (keys.length === 0) return
	// Write phase: open a fresh readwrite transaction and delete all at once.
	const store = getStore(db, CHUNKS_STORE, 'readwrite')
	await Promise.all(keys.map((key) => promisifyRequest(store.delete(key))))
}
