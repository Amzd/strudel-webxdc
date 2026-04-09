import {
	getAllTrackFilenames,
	getTrackBlob,
	hasTrack,
	storeChunk,
	tryAssembleTrack,
} from './lib/storage'
import { validateMp3ChunkPayload } from './lib/validate-payload'

/** Base64 characters per chunk — stays well within typical sendUpdateMaxSize */
const BASE64_CHARS_PER_CHUNK = 60_000

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
	 * Reads a File and sends it as chunked webxdc updates.
	 *
	 * @param {File} file
	 */
	async function sendFile(file) {
		const buffer = await file.arrayBuffer()
		const bytes = new Uint8Array(buffer)

		// Build the binary string in 8 KiB slices so String.fromCharCode.apply
		// never exceeds the call-stack argument limit, and avoids allocating a
		// per-byte string array like the previous Array.from approach did.
		const SLICE = 8192
		let binary = ''
		for (let i = 0; i < bytes.length; i += SLICE) {
			binary += String.fromCharCode.apply(
				null,
				Array.from(bytes.subarray(i, i + SLICE))
			)
		}
		const base64 = btoa(binary)

		const uploadId = crypto.randomUUID()
		const totalChunks = Math.ceil(base64.length / BASE64_CHARS_PER_CHUNK)

		for (let i = 0; i < totalChunks; i++) {
			const chunk = base64.slice(
				i * BASE64_CHARS_PER_CHUNK,
				(i + 1) * BASE64_CHARS_PER_CHUNK
			)
			/** @satisfies {import('./lib/validate-payload').Mp3ChunkPayload} */
			const payload = {
				type: 'mp3_chunk',
				uploadId,
				filename: file.name,
				chunkIndex: i,
				totalChunks,
				data: chunk,
			}
			window.webxdc.sendUpdate({ payload }, '')
		}
	}

	// ── webxdc update listener ─────────────────────────────────────────────

	/** @param {import('@webxdc/types').ReceivedStatusUpdate<unknown>} update */
	async function handleUpdate(update) {
		if (!validateMp3ChunkPayload(update.payload)) return

		const { uploadId, filename, chunkIndex, totalChunks, data } = update.payload

		const alreadyStored = await hasTrack(filename)
		if (alreadyStored && !tracks.includes(filename)) {
			tracks.push(filename)
			addToPlaylistUI(filename)
			return
		}
		if (alreadyStored) return

		await storeChunk(uploadId, filename, chunkIndex, totalChunks, data)

		const assembledFilename = await tryAssembleTrack(
			uploadId,
			filename,
			totalChunks
		)
		if (assembledFilename && !tracks.includes(assembledFilename)) {
			tracks.push(assembledFilename)
			addToPlaylistUI(assembledFilename)
		}
	}

	// Serialize update handling: webxdc does not await the async callback, so
	// without this queue all chunk handlers for a single upload run concurrently.
	// That causes every handler to find all chunks present and attempt a full
	// (CPU-intensive) assembly at the same time, freezing the main thread.
	let processingQueue = Promise.resolve()

	await window.webxdc.setUpdateListener((update) => {
		processingQueue = processingQueue.then(() => handleUpdate(update))
	})

	// ── load tracks already in IndexedDB ──────────────────────────────────

	const stored = await getAllTrackFilenames()
	for (const filename of stored) {
		if (!tracks.includes(filename)) {
			tracks.push(filename)
			addToPlaylistUI(filename)
		}
	}
}
