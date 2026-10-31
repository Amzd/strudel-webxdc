// Line-based diff and three-way merge, adapted from the Code sync webxdc.

function lineEdits(baseLines, changedLines) {
    const rows = baseLines.length + 1
    const cols = changedLines.length + 1
    if (rows * cols > 1000000) return null

    const lcs = Array.from({ length: rows }, () => new Uint32Array(cols))
    for (let i = baseLines.length - 1; i >= 0; i--) {
        for (let j = changedLines.length - 1; j >= 0; j--) {
            lcs[i][j] =
                baseLines[i] === changedLines[j]
                    ? lcs[i + 1][j + 1] + 1
                    : Math.max(lcs[i + 1][j], lcs[i][j + 1])
        }
    }

    const edits = []
    let i = 0
    let j = 0
    while (i < baseLines.length || j < changedLines.length) {
        if (
            i < baseLines.length &&
            j < changedLines.length &&
            baseLines[i] === changedLines[j]
        ) {
            i++
            j++
            continue
        }

        const start = i
        const replacement = []
        while (i < baseLines.length || j < changedLines.length) {
            if (
                i < baseLines.length &&
                j < changedLines.length &&
                baseLines[i] === changedLines[j]
            )
                break
            if (
                i < baseLines.length &&
                (j === changedLines.length || lcs[i + 1][j] >= lcs[i][j + 1])
            ) {
                i++
            } else {
                replacement.push(changedLines[j])
                j++
            }
        }
        edits.push({ start, end: i, replacement })
    }
    return edits
}

export function changedLineIndexes(base, changed) {
    const baseLines = base.split('\n')
    const changedLines = changed.split('\n')
    const edits = lineEdits(baseLines, changedLines)
    const indexes = new Set()
    if (!edits) {
        for (let i = 0; i < changedLines.length; i++) indexes.add(i)
        return indexes
    }

    for (const edit of edits) {
        if (edit.replacement.length) {
            for (let i = 0; i < edit.replacement.length; i++) {
                indexes.add(Math.min(edit.start + i, changedLines.length - 1))
            }
        } else if (changedLines.length) {
            indexes.add(Math.min(edit.start, changedLines.length - 1))
        }
    }
    return indexes
}

function mergeAdditiveLines(left, right) {
    const rows = left.length + 1
    const cols = right.length + 1
    if (rows * cols > 1000000) {
        const result = []
        for (let i = 0; i < Math.max(left.length, right.length); i++) {
            const leftLine = left[i]
            const rightLine = right[i]
            if (leftLine === rightLine) {
                if (leftLine !== undefined) result.push(leftLine)
            } else {
                if (leftLine !== undefined) result.push(leftLine)
                if (rightLine !== undefined) result.push(rightLine)
            }
        }
        return result
    }

    const lcs = Array.from({ length: rows }, () => new Uint32Array(cols))
    for (let i = left.length - 1; i >= 0; i--) {
        for (let j = right.length - 1; j >= 0; j--) {
            lcs[i][j] =
                left[i] === right[j]
                    ? lcs[i + 1][j + 1] + 1
                    : Math.max(lcs[i + 1][j], lcs[i][j + 1])
        }
    }

    const result = []
    let i = 0
    let j = 0
    while (i < left.length && j < right.length) {
        if (left[i] === right[j]) {
            result.push(left[i])
            i++
            j++
        } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
            result.push(left[i++])
        } else {
            result.push(right[j++])
        }
    }
    result.push(...left.slice(i), ...right.slice(j))
    return result
}

export function mergeEditorText(base, local, incoming) {
    if (local === base) return incoming
    if (incoming === base || local === incoming) return local

    const baseLines = base.split('\n')
    const localLines = local.split('\n')
    const incomingLines = incoming.split('\n')
    const localEdits = lineEdits(baseLines, localLines)
    const incomingEdits = lineEdits(baseLines, incomingLines)
    if (!localEdits || !incomingEdits) {
        return mergeAdditiveLines(localLines, incomingLines).join('\n')
    }

    const conflicts = (a, b) => {
        const bothInsertAtSamePoint =
            a.start === a.end && b.start === b.end && a.start === b.start
        const rangesOverlap = a.start < b.end && b.start < a.end
        const insertionInsideA =
            b.start === b.end && b.start > a.start && b.start < a.end
        const insertionInsideB =
            a.start === a.end && a.start > b.start && a.start < b.end
        return (
            bothInsertAtSamePoint ||
            rangesOverlap ||
            insertionInsideA ||
            insertionInsideB
        )
    }

    const entries = [
        ...localEdits.map((edit) => ({ edit, side: 'local' })),
        ...incomingEdits.map((edit) => ({ edit, side: 'incoming' })),
    ]
    const parents = entries.map((_, index) => index)
    const find = (index) => {
        while (parents[index] !== index) {
            parents[index] = parents[parents[index]]
            index = parents[index]
        }
        return index
    }
    const unite = (a, b) => {
        const rootA = find(a)
        const rootB = find(b)
        if (rootA !== rootB) parents[rootB] = rootA
    }

    for (let i = 0; i < localEdits.length; i++) {
        for (let j = 0; j < incomingEdits.length; j++) {
            if (conflicts(localEdits[i], incomingEdits[j]))
                unite(i, localEdits.length + j)
        }
    }

    const groups = new Map()
    entries.forEach((entry, index) => {
        const root = find(index)
        if (!groups.has(root)) groups.set(root, [])
        groups.get(root).push(entry)
    })

    const applyGroup = (edits, start, end) => {
        const result = []
        let cursor = start
        for (const edit of edits.sort(
            (a, b) => a.start - b.start || a.end - b.end
        )) {
            result.push(
                ...baseLines.slice(cursor, edit.start),
                ...edit.replacement
            )
            cursor = edit.end
        }
        result.push(...baseLines.slice(cursor, end))
        return result
    }

    const edits = []
    for (const group of groups.values()) {
        const localGroup = group
            .filter((entry) => entry.side === 'local')
            .map((entry) => entry.edit)
        const incomingGroup = group
            .filter((entry) => entry.side === 'incoming')
            .map((entry) => entry.edit)
        if (!localGroup.length || !incomingGroup.length) {
            edits.push(...group.map((entry) => entry.edit))
            continue
        }

        const groupEdits = [...localGroup, ...incomingGroup]
        const start = Math.min(...groupEdits.map((edit) => edit.start))
        const end = Math.max(...groupEdits.map((edit) => edit.end))
        const localResult = applyGroup(localGroup, start, end)
        const incomingResult = applyGroup(incomingGroup, start, end)
        edits.push({
            start,
            end,
            replacement: mergeAdditiveLines(localResult, incomingResult),
        })
    }

    edits.sort((a, b) => a.start - b.start || a.end - b.end)
    const result = []
    let cursor = 0
    for (const edit of edits) {
        result.push(...baseLines.slice(cursor, edit.start), ...edit.replacement)
        cursor = edit.end
    }
    result.push(...baseLines.slice(cursor))
    return result.join('\n')
}
