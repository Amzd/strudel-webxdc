const DB_NAME = 'mp3player'
const DB_VERSION = 2
const TRACKS_STORE = 'tracks'
const CHUNKS_STORE = 'pending_chunks'

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
				const chunksStore = db.createObjectStore(CHUNKS_STORE, {
					keyPath: 'key',
				})
				chunksStore.createIndex('by_upload', 'uploadId')
			} else if (oldVersion < 2) {
				// Add the uploadId index that was missing in v1
				const tx = /** @type {IDBOpenDBRequest} */ (event.target).transaction
				const chunksStore = /** @type {IDBTransaction} */ (tx).objectStore(
					CHUNKS_STORE
				)
				chunksStore.createIndex('by_upload', 'uploadId')
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
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {'readonly' | 'readwrite'} mode
 *
 * @returns {IDBObjectStore}
 */
function getStore(db, storeName, mode) {
	return db.transaction(storeName, mode).objectStore(storeName)
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
 * Returns all stored track filenames.
 *
 * @returns {Promise<string[]>}
 */
export async function getAllTrackFilenames() {
	const db = await openDB()
	const store = getStore(db, TRACKS_STORE, 'readonly')
	/** @type {{ filename: string }[]} */
	const records = await promisifyRequest(store.getAll())
	return records.map((r) => r.filename)
}

/**
 * Returns the blob for the given filename, or null if not stored.
 *
 * @param {string} filename
 *
 * @returns {Promise<Blob | null>}
 */
export async function getTrackBlob(filename) {
	const db = await openDB()
	const store = getStore(db, TRACKS_STORE, 'readonly')
	/** @type {{ filename: string; blob: Blob } | undefined} */
	const record = await promisifyRequest(store.get(filename))
	return record ? record.blob : null
}

/**
 * Returns true if a track with this filename is already stored.
 *
 * @param {string} filename
 *
 * @returns {Promise<boolean>}
 */
export async function hasTrack(filename) {
	const db = await openDB()
	const store = getStore(db, TRACKS_STORE, 'readonly')
	const record = await promisifyRequest(store.get(filename))
	return record !== undefined
}

/**
 * Stores a track blob.
 *
 * @param {string} filename
 * @param {Blob} blob
 *
 * @returns {Promise<void>}
 */
export async function storeTrack(filename, blob) {
	const db = await openDB()
	const store = getStore(db, TRACKS_STORE, 'readwrite')
	await promisifyRequest(store.put({ filename, blob }))
}

/**
 * Stores a single chunk of a pending upload.
 *
 * @param {string} uploadId
 * @param {string} filename
 * @param {number} chunkIndex
 * @param {number} totalChunks
 * @param {string} data Base64-encoded chunk data
 *
 * @returns {Promise<void>}
 */
export async function storeChunk(
	uploadId,
	filename,
	chunkIndex,
	totalChunks,
	data
) {
	const db = await openDB()
	const store = getStore(db, CHUNKS_STORE, 'readwrite')
	await promisifyRequest(
		store.put({
			key: `${uploadId}_${chunkIndex}`,
			uploadId,
			filename,
			chunkIndex,
			totalChunks,
			data,
		})
	)
}

/**
 * Retrieves all stored chunks for the given uploadId, sorted by index.
 *
 * @param {string} uploadId
 *
 * @returns {Promise<{ chunkIndex: number; data: string }[]>}
 */
async function getChunksForUpload(uploadId) {
	const db = await openDB()
	const index = db
		.transaction(CHUNKS_STORE, 'readonly')
		.objectStore(CHUNKS_STORE)
		.index('by_upload')
	/** @type {{ uploadId: string; chunkIndex: number; data: string }[]} */
	const chunks = await promisifyRequest(index.getAll(uploadId))
	return chunks.sort((a, b) => a.chunkIndex - b.chunkIndex)
}

/**
 * Deletes all chunks for the given uploadId.
 *
 * @param {string} uploadId
 * @param {number} totalChunks
 *
 * @returns {Promise<void>}
 */
async function deleteChunks(uploadId, totalChunks) {
	const db = await openDB()
	const store = getStore(db, CHUNKS_STORE, 'readwrite')
	await Promise.all(
		Array.from({ length: totalChunks }, (_, i) =>
			promisifyRequest(store.delete(`${uploadId}_${i}`))
		)
	)
}

/**
 * Checks if all chunks for an upload are present and, if so, assembles and
 * stores the track. Returns the filename if assembly succeeded, null
 * otherwise.
 *
 * @param {string} uploadId
 * @param {string} filename
 * @param {number} totalChunks
 *
 * @returns {Promise<string | null>}
 */
export async function tryAssembleTrack(uploadId, filename, totalChunks) {
	const chunks = await getChunksForUpload(uploadId)
	if (chunks.length < totalChunks) return null

	// Decode each chunk's base64 to a Uint8Array individually, then let Blob
	// concatenate the parts.  This avoids building one giant joined base64
	// string and a single massive binary string before allocation.
	const parts = chunks.map((c) => {
		const binary = atob(c.data)
		const bytes = new Uint8Array(binary.length)
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i)
		}
		return bytes
	})
	const blob = new Blob(parts, { type: 'audio/mpeg' })
	await storeTrack(filename, blob)
	await deleteChunks(uploadId, totalChunks)
	return filename
}
