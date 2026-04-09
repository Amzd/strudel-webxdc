const DB_NAME = 'mp3player'
const DB_VERSION = 1
const TRACKS_STORE = 'tracks'
const CHUNKS_STORE = 'pending_chunks'

/** @returns {Promise<IDBDatabase>} */
function openDB() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION)
		request.onupgradeneeded = (event) => {
			const db = /** @type {IDBOpenDBRequest} */ (event.target).result
			if (!db.objectStoreNames.contains(TRACKS_STORE)) {
				db.createObjectStore(TRACKS_STORE, { keyPath: 'filename' })
			}
			if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
				db.createObjectStore(CHUNKS_STORE, { keyPath: 'key' })
			}
		}
		request.onsuccess = (event) =>
			resolve(/** @type {IDBOpenDBRequest} */ (event.target).result)
		request.onerror = (event) =>
			reject(/** @type {IDBOpenDBRequest} */ (event.target).error)
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
	const store = getStore(db, CHUNKS_STORE, 'readonly')
	/** @type {{ uploadId: string; chunkIndex: number; data: string }[]} */
	const all = await promisifyRequest(store.getAll())
	return all
		.filter((c) => c.uploadId === uploadId)
		.sort((a, b) => a.chunkIndex - b.chunkIndex)
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

	const base64 = chunks.map((c) => c.data).join('')
	const binary = atob(base64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i)
	}
	const blob = new Blob([bytes], { type: 'audio/mpeg' })
	await storeTrack(filename, blob)
	await deleteChunks(uploadId, totalChunks)
	return filename
}
