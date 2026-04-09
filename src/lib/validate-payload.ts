export type Mp3ChunkPayload = {
	type: 'mp3_chunk'
	uploadId: string
	filename: string
	chunkIndex: number
	totalChunks: number
	data: string
}

export function validateMp3ChunkPayload(
	payload: unknown
): payload is Mp3ChunkPayload {
	if (!payload) return false
	if (typeof payload !== 'object') return false

	const typeIsValid = 'type' in payload && payload.type === 'mp3_chunk'
	const uploadIdIsValid =
		'uploadId' in payload && typeof payload.uploadId === 'string'
	const filenameIsValid =
		'filename' in payload && typeof payload.filename === 'string'
	const chunkIndexIsValid =
		'chunkIndex' in payload && typeof payload.chunkIndex === 'number'
	const totalChunksIsValid =
		'totalChunks' in payload && typeof payload.totalChunks === 'number'
	const dataIsValid = 'data' in payload && typeof payload.data === 'string'

	return (
		typeIsValid &&
		uploadIdIsValid &&
		filenameIsValid &&
		chunkIndexIsValid &&
		totalChunksIsValid &&
		dataIsValid
	)
}
