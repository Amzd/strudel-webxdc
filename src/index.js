import { RealTime } from '@webxdc/realtime'

import {
	CHUNK_SIZE,
	deleteTrackChunks,
	getAllTrackFilenames,
	getAllTrackMetas,
	getChunkBlob,
	getTrackBlob,
	hasTrack,
	storeChunkBlob,
	storeTrack,
	storeTrackMeta,
} from './lib/storage'
import { isChunkRequest, isChunkResponse } from './lib/validate-payload'

init()

async function init() {
	const uploadBtn = /** @type {HTMLButtonElement} */ (
		document.getElementById('upload-btn')
	)
	const fileInput = /** @type {HTMLInputElement} */ (
		document.getElementById('file-input')
	)
	const playlist = /** @type {HTMLElement} */ (
		document.getElementById('playlist')
	)
	const emptyMsg = /** @type {HTMLElement} */ (
		document.getElementById('empty-msg')
	)
	const nowPlaying = /** @type {HTMLElement} */ (
		document.getElementById('now-playing')
	)
	const playBtn = /** @type {HTMLButtonElement} */ (
		document.getElementById('play-btn')
	)
	const prevBtn = /** @type {HTMLButtonElement} */ (
		document.getElementById('prev-btn')
	)
	const nextBtn = /** @type {HTMLButtonElement} */ (
		document.getElementById('next-btn')
	)
	const progressBar = /** @type {HTMLInputElement} */ (
		document.getElementById('progress-bar')
	)
	const currentTimeEl = /** @type {HTMLElement} */ (
		document.getElementById('current-time')
	)
	const durationEl = /** @type {HTMLElement} */ (
		document.getElementById('duration')
	)

	/** @type {string[]} */
	let tracks = []
	let currentIndex = -1
	let isPlaying = false
	/** @type {string | null} */
	let currentObjectUrl = null

	const audio = new Audio()

	// ── helpers ────────────────────────────────────────────────────────────

	/** @param {number} seconds */
	function formatTime(seconds) {
		if (!isFinite(seconds)) return '0:00'
		const m = Math.floor(seconds / 60)
		const s = Math.floor(seconds % 60)
		return `${m}:${s.toString().padStart(2, '0')}`
	}

	function updatePlayButton() {
		playBtn.textContent = isPlaying ? '⏸' : '▶'
		playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play')
	}

	/** @param {number} index */
	function highlightTrack(index) {
		document
			.querySelectorAll('.playlist-item')
			.forEach((el, i) => el.classList.toggle('active', i === index))
	}

	/** @param {string} filename */
	function addToPlaylistUI(filename) {
		emptyMsg.hidden = true
		const item = document.createElement('button')
		item.className = 'playlist-item'
		item.textContent = filename
		item.type = 'button'
		item.addEventListener('click', () => {
			const index = tracks.indexOf(filename)
			if (index !== -1) playTrack(index)
		})
		playlist.appendChild(item)
	}

	/** @param {number} index */
	async function playTrack(index) {
		if (index < 0 || index >= tracks.length) return

		const filename = tracks[index]
		if (!filename) return
		const blob = await getTrackBlob(filename)
		if (!blob) return

		if (currentObjectUrl) {
			URL.revokeObjectURL(currentObjectUrl)
			currentObjectUrl = null
		}

		currentObjectUrl = URL.createObjectURL(blob)
		audio.src = currentObjectUrl
		audio.play()

		currentIndex = index
		isPlaying = true
		nowPlaying.textContent = filename
		playBtn.disabled = false
		updatePlayButton()
		highlightTrack(index)
	}

	function togglePlay() {
		if (currentIndex === -1 && tracks.length > 0) {
			playTrack(0)
			return
		}
		if (isPlaying) {
			audio.pause()
			isPlaying = false
		} else {
			audio.play()
			isPlaying = true
		}
		updatePlayButton()
	}

	// ── audio events ───────────────────────────────────────────────────────

	audio.addEventListener('ended', () => {
		const nextIndex = currentIndex + 1
		if (nextIndex < tracks.length) {
			playTrack(nextIndex)
		} else {
			isPlaying = false
			updatePlayButton()
		}
	})

	audio.addEventListener('timeupdate', () => {
		if (!isFinite(audio.duration)) return
		const pct = (audio.currentTime / audio.duration) * 100
		progressBar.value = String(pct)
		currentTimeEl.textContent = formatTime(audio.currentTime)
	})

	audio.addEventListener('loadedmetadata', () => {
		durationEl.textContent = formatTime(audio.duration)
		progressBar.value = '0'
	})

	audio.addEventListener('play', () => {
		isPlaying = true
		updatePlayButton()
	})

	audio.addEventListener('pause', () => {
		isPlaying = false
		updatePlayButton()
	})

	// ── controls ───────────────────────────────────────────────────────────

	playBtn.addEventListener('click', togglePlay)

	prevBtn.addEventListener('click', () => {
		if (currentIndex > 0) playTrack(currentIndex - 1)
	})

	nextBtn.addEventListener('click', () => {
		if (currentIndex < tracks.length - 1) playTrack(currentIndex + 1)
	})

	progressBar.addEventListener('input', () => {
		if (!isFinite(audio.duration)) return
		audio.currentTime = (Number(progressBar.value) / 100) * audio.duration
	})

	// ── upload ─────────────────────────────────────────────────────────────

	uploadBtn.addEventListener('click', () => fileInput.click())

	fileInput.addEventListener('change', async () => {
		if (!fileInput.files) return
		for (const file of Array.from(fileInput.files)) {
			if (!file.type.includes('audio') && !file.name.endsWith('.mp3')) continue
			await sendFile(file)
		}
		fileInput.value = ''
	})

	/**
	 * Stores a file locally and advertises it to peers via realtime state so they
	 * can pull it chunk by chunk.
	 *
	 * @param {File} file
	 */
	async function sendFile(file) {
		const id = crypto.randomUUID()
		const chunkCount = Math.ceil(file.size / CHUNK_SIZE)
		const lastModified = file.lastModified || Date.now()

		// Store the full blob immediately so it is playable right away and so we
		// can serve chunk requests by slicing without keeping separate chunk blobs.
		await storeTrack(file.name, file)

		/** @satisfies {import('./lib/validate-payload').TrackMeta} */
		const meta = {
			id,
			filename: file.name,
			size: file.size,
			chunkCount,
			lastModified,
			pending: [], // We have all chunks.
		}
		await storeTrackMeta(meta)

		if (!tracks.includes(file.name)) {
			tracks.push(file.name)
			addToPlaylistUI(file.name)
		}

		// Broadcast to peers so they can start requesting chunks.
		const state = realtime.getState()
		const existingTracks = state?.tracks ?? []
		realtime.setState({ tracks: [...existingTracks, meta] })
	}

	// ── realtime sync ──────────────────────────────────────────────────────

	// currentRequest is read/written only in syncChunks and handlePayload, both
	// of which run on the JS single-threaded event loop, so no locking is needed.
	/** @type {import('./lib/validate-payload').ChunkRequest | null} */
	let currentRequest = null

	/** Milliseconds before a chunk request is considered timed-out. */
	const CHUNK_REQUEST_TIMEOUT_MS = 10_000
	/** Poll interval while a chunk request is in flight. */
	const SYNC_POLL_ACTIVE_MS = 10
	/** Poll interval while no chunk request is in flight. */
	const SYNC_POLL_IDLE_MS = 100

	/**
	 * Fisher-Yates shuffle – returns a new array.
	 *
	 * @template T
	 * @param {T[]} arr
	 *
	 * @returns {T[]}
	 */
	function shuffle(arr) {
		const a = arr.slice()
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1))
			const tmp = a[i]
			a[i] = /** @type {T} */ (a[j])
			a[j] = /** @type {T} */ (tmp)
		}
		return a
	}

	/**
	 * Tries to find a peer who can serve `chunkIndex` for the given track.
	 * Returns null if no peer is available.
	 *
	 * @param {import('./lib/validate-payload').TrackMeta} meta
	 * @param {number} chunkIndex
	 *
	 * @returns {import('./lib/validate-payload').ChunkRequest | null}
	 */
	function createRequest(meta, chunkIndex) {
		for (const peer of shuffle(realtime.getPeers())) {
			const peerFile = peer.state?.tracks?.find((t) => t.id === meta.id)
			if (
				peerFile &&
				peerFile.lastModified === meta.lastModified &&
				!peerFile.pending.includes(chunkIndex)
			) {
				return {
					time: Date.now(),
					trackId: meta.id,
					chunkIndex,
					peer: peer.id,
				}
			}
		}
		return null
	}

	/**
	 * Periodic loop: requests one missing chunk from a peer that has it. Runs
	 * every 100 ms when idle, 10 ms while a request is in flight.
	 */
	function syncChunks() {
		if (
			!currentRequest ||
			Date.now() - currentRequest.time > CHUNK_REQUEST_TIMEOUT_MS
		) {
			let request = null
			const state = realtime.getState()
			const myTracks = state?.tracks ?? []
			outer: for (const meta of myTracks) {
				if (meta.pending.length > 0) {
					for (const chunkIndex of shuffle(meta.pending)) {
						request = createRequest(meta, chunkIndex)
						if (request) break outer
					}
				}
			}
			if (request) {
				currentRequest = request
				realtime.sendPayload({ request })
			}
		}
		setTimeout(
			syncChunks,
			currentRequest ? SYNC_POLL_ACTIVE_MS : SYNC_POLL_IDLE_MS
		)
	}

	/**
	 * Assembles a fully-received track from its in-progress chunk blobs, stores
	 * it in the assembled-track store, cleans up, and adds it to the playlist.
	 *
	 * @param {import('./lib/validate-payload').TrackMeta} meta
	 */
	async function assembleTrack(meta) {
		const parts = []
		for (let i = 0; i < meta.chunkCount; i++) {
			const chunk = await getChunkBlob(meta.id, i, null)
			if (chunk) parts.push(chunk)
		}
		const blob = new Blob(parts, { type: 'audio/mpeg' })
		await storeTrack(meta.filename, blob)
		await deleteTrackChunks(meta.id)

		if (!tracks.includes(meta.filename)) {
			tracks.push(meta.filename)
			addToPlaylistUI(meta.filename)
		}
	}

	/**
	 * Discovers new tracks from connected peers and queues them for download.
	 *
	 * @param {import('@webxdc/realtime').Peer<
	 * 	import('./lib/validate-payload').AppState
	 * >[]} peers
	 */
	async function syncFileList(peers) {
		const state = realtime.getState()
		const myTracks = state?.tracks ?? []
		let changed = false

		for (const peer of peers) {
			const peerTracks = peer.state?.tracks ?? []
			for (const peerTrack of peerTracks) {
				if (peerTrack.size <= 0) continue
				const existing = myTracks.find((t) => t.id === peerTrack.id)
				if (!existing) {
					// New track discovered from a peer.
					const { id, filename, size, chunkCount, lastModified } = peerTrack
					const alreadyAssembled = await hasTrack(filename)
					const newMeta = {
						id,
						filename,
						size,
						chunkCount,
						lastModified,
						// If already assembled, no chunks are pending; otherwise queue all.
						pending: alreadyAssembled
							? []
							: Array.from({ length: chunkCount }, (_, i) => i),
					}
					await storeTrackMeta(newMeta)
					myTracks.push(newMeta)
					if (alreadyAssembled && !tracks.includes(filename)) {
						tracks.push(filename)
						addToPlaylistUI(filename)
					}
					changed = true
				}
			}
		}

		if (changed) {
			realtime.setState({ tracks: myTracks })
		}
	}

	/**
	 * Handles an incoming realtime payload (chunk request or chunk response).
	 *
	 * @param {string} _deviceId
	 * @param {unknown} payload
	 */
	async function handlePayload(_deviceId, payload) {
		if (isChunkRequest(payload)) {
			const { request } = payload
			// Only the targeted peer responds.
			if (request.peer !== realtime.getDeviceId()) return

			const meta = realtime
				.getState()
				?.tracks?.find((t) => t.id === request.trackId)
			if (!meta) return

			const chunkBlob = await getChunkBlob(
				request.trackId,
				request.chunkIndex,
				meta.filename
			)
			if (!chunkBlob) return

			const data = new Uint8Array(await chunkBlob.arrayBuffer())
			realtime.sendPayload({
				response: {
					trackId: request.trackId,
					lastModified: meta.lastModified,
					chunkIndex: request.chunkIndex,
					data,
				},
			})
		} else if (isChunkResponse(payload)) {
			const { response } = payload
			const state = realtime.getState()
			if (!state) return

			const meta = state.tracks.find((t) => t.id === response.trackId)
			if (!meta) return
			if (meta.lastModified !== response.lastModified) return
			if (!meta.pending.includes(response.chunkIndex)) return

			await storeChunkBlob(
				response.trackId,
				response.chunkIndex,
				new Blob([response.data])
			)

			meta.pending = meta.pending.filter((i) => i !== response.chunkIndex)
			await storeTrackMeta(meta)

			const updatedTracks = state.tracks.map((t) =>
				t.id === response.trackId ? meta : t
			)
			realtime.setState({ tracks: updatedTracks })

			if (
				currentRequest?.trackId === response.trackId &&
				currentRequest?.chunkIndex === response.chunkIndex
			) {
				currentRequest = null
			}

			if (meta.pending.length === 0) {
				await assembleTrack(meta)
			}
		}
	}

	/**
	 * @type {import('@webxdc/realtime').RealTime<
	 * 	import('./lib/validate-payload').AppState,
	 * 	import('./lib/validate-payload').AppPayload
	 * >}
	 */
	const realtime = new RealTime({
		onPeersChanged: (peers) => {
			void syncFileList(peers)
		},
		onPayload: (_deviceId, payload) => {
			void handlePayload(_deviceId, payload)
		},
	})

	// ── load tracks already in IndexedDB ──────────────────────────────────

	const storedFilenames = await getAllTrackFilenames()
	for (const filename of storedFilenames) {
		if (!tracks.includes(filename)) {
			tracks.push(filename)
			addToPlaylistUI(filename)
		}
	}

	// Rebuild realtime state from persisted metadata so peers immediately see
	// our available tracks when we connect.
	const allMetas = await getAllTrackMetas()
	realtime.setState({ tracks: allMetas })
	realtime.connect()
	window.addEventListener('beforeunload', () => realtime.disconnect())

	setTimeout(syncChunks, 100)
}
