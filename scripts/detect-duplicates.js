import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDir = path.resolve(__dirname, '..', 'data')

import { reportError, reportInfo, reportWarning } from './utils.js'

function normalizeName (value) {
    return String(value ?? '').trim().toLocaleLowerCase('en-GB')
}

function getCoordinateKey (entry) {
    const lat = Number(entry?.coordinates?.lat)
    const lng = Number(entry?.coordinates?.lng)

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null
    }

    return `${lat},${lng}`
}

function formatRecord (record) {
    const coords = record.coordinateKey ?? 'missing coordinates'
    return `${record.name} (${coords}) in ${record.file} [id=${record.id}]`
}

async function main () {
    const files = (await readdir(dataDir)).
        filter((file) => file.endsWith('.json')).
        sort((a, b) => a.localeCompare(b))

    const byName = new Map()

    for (const file of files) {
        const fullPath = path.join(dataDir, file)
        const raw = await readFile(fullPath, 'utf8')
        const parsed = JSON.parse(raw)

        if (!Array.isArray(parsed)) {
            throw new Error(`Expected "${file}" to contain an array`)
        }

        for (const entry of parsed) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                continue
            }

            const normalizedName = normalizeName(entry.name)
            if (!normalizedName) {
                continue
            }

            const record = {
                file,
                id: entry.id ?? 'unknown',
                name: entry.name,
                coordinateKey: getCoordinateKey(entry),
            }

            if (!byName.has(normalizedName)) {
                byName.set(normalizedName, [])
            }

            byName.get(normalizedName).push(record)
        }
    }

    const duplicates = []
    const possibleDuplicates = []

    for (const [, records] of byName) {
        if (records.length < 2) {
            continue
        }

        const byCoordinates = new Map()

        for (const record of records) {
            const key = record.coordinateKey ?? '__missing__'
            if (!byCoordinates.has(key)) {
                byCoordinates.set(key, [])
            }
            byCoordinates.get(key).push(record)
        }

        for (const [key, group] of byCoordinates) {
            if (key !== '__missing__' && group.length > 1) {
                duplicates.push(group)
            }
        }

        if (byCoordinates.size > 1) {
            const filesInGroup = new Set(records.map((record) => record.file))
            if (filesInGroup.size === 1) {
                possibleDuplicates.push(records)
            }
        }
    }

    if (duplicates.length > 0) {
        const summary =
            'Duplicate entries found (same name and same coordinates).'
        reportError(summary)

        const errorLines = [`Warnings: ${summary}`]
        for (const group of duplicates) {
            errorLines.push(`${group[0].name}`)
            for (const record of group) {
                const message = formatRecord(record)
                errorLines.push(`  - ${message}`)
            }
        }
        errorLines.push('')
        reportError(errorLines.join('\n'))
        console.log('')
    }

    if (possibleDuplicates.length > 0) {
        const summary =
            'Same name found with different coordinates (possible duplicates).'
        const warningLines = [`Warnings: ${summary}`]
        for (const group of possibleDuplicates) {
            warningLines.push(`${group[0].name}`)
            for (const record of group) {
                const message = formatRecord(record)
                warningLines.push(`  - ${message}`)
            }
        }
        warningLines.push('')
        reportWarning(warningLines.join('\n'))
    }

    if (duplicates.length === 0 && possibleDuplicates.length === 0) {
        reportInfo(`No duplicates found across ${files.length} file(s).`)
        return
    }

    reportInfo(
        `Checked ${files.length} file(s): ${duplicates.length} duplicate group(s), ${possibleDuplicates.length} warning group(s).`)

    if (duplicates.length > 0) {
        process.exitCode = 1
    }
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    reportError(message)
    process.exitCode = 1
})
