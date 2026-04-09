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

function getCoordinates (record) {
    const key = record.coordinateKey
    if (!key || key === '__missing__') {
        return null
    }

    const [latRaw, lngRaw] = key.split(',')
    const lat = Number(latRaw)
    const lng = Number(lngRaw)

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null
    }

    return { lat, lng }
}

function getDistanceKm (a, b) {
    const toRadians = (value) => (value * Math.PI) / 180
    const earthRadiusKm = 6371

    const dLat = toRadians(b.lat - a.lat)
    const dLng = toRadians(b.lng - a.lng)
    const lat1 = toRadians(a.lat)
    const lat2 = toRadians(b.lat)

    const haversine =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

    return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function hasNearbyDistinctCoordinates (records, thresholdKm) {
    const recordsWithCoordinates = records.
        map((record) => ({
            record,
            coordinates: getCoordinates(record),
        })).
        filter((item) => item.coordinates !== null)

    for (let i = 0; i < recordsWithCoordinates.length; i += 1) {
        const current = recordsWithCoordinates[i]
        for (let j = i + 1; j < recordsWithCoordinates.length; j += 1) {
            const candidate = recordsWithCoordinates[j]
            if (current.record.coordinateKey === candidate.record.coordinateKey) {
                continue
            }

            const distanceKm = getDistanceKm(current.coordinates, candidate.coordinates)
            if (distanceKm <= thresholdKm) {
                return true
            }
        }
    }

    return false
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
            const hasNearbyCoordinates = hasNearbyDistinctCoordinates(records, 1)
            if (filesInGroup.size === 1 && hasNearbyCoordinates) {
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
