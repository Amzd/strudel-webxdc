const SEEK_ID = Symbol('safeSeekId')

HTMLMediaElement.prototype.safeSeek = function (targetTime) {
    const audio = this

    // initialize counter if not present
    if (!audio[SEEK_ID]) {
        audio[SEEK_ID] = 0
    }

    const currentId = ++audio[SEEK_ID]

    return new Promise((resolve) => {
        function trySeek() {
            // cancel if a newer seek started
            if (currentId !== audio[SEEK_ID]) {
                cleanup()
                resolve(false)
                return
            }

            const ranges = audio.seekable

            for (let i = 0; i < ranges.length; i++) {
                if (
                    targetTime >= ranges.start(i) &&
                    targetTime <= ranges.end(i)
                ) {
                    audio.currentTime = targetTime
                    cleanup()
                    resolve(true)
                    return
                }
            }
            // this will seek to closest seekable time and load more seekable area
            audio.currentTime = targetTime
        }

        function cleanup() {
            audio.removeEventListener('progress', trySeek)
            audio.removeEventListener('loadedmetadata', trySeek)
            audio.removeEventListener('loadeddata', trySeek)
            audio.removeEventListener('timeupdate', trySeek)
        }

        // optimistic attempt (works instantly if already seekable)
        trySeek()

        // wait for updates and try again.
        // timeupdate gets called after audio.currentTime is changed
        // to the closest seekable time which will cause more seekable
        // area to be loaded so we can try again.
        audio.addEventListener('progress', trySeek)
        audio.addEventListener('loadedmetadata', trySeek)
        audio.addEventListener('loadeddata', trySeek)
        audio.addEventListener('timeupdate', trySeek)
    })
}
