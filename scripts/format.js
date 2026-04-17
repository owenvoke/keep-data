import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validate as isUuid, version as uuidVersion, v7 as uuidv7 } from 'uuid'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDir = path.resolve(__dirname, '..', 'data')

import { reportError, reportInfo, reportWarning } from './utils.js'

function isUuidV7 (value) {
    return typeof value === 'string' && isUuid(value) && uuidVersion(value) ===
        7
}

function sortByName (a, b) {
    return String(a.name).
        localeCompare(String(b.name), 'en', { sensitivity: 'base' })
}

function reorderEntry (entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return entry
    }

    const ordered = {}

    if ('id' in entry) {
        ordered.id = entry.id
    }
    if ('name' in entry) {
        ordered.name = entry.name
    }
    if ('country' in entry) {
        ordered.country = entry.country
    }
    if ('region' in entry) {
        ordered.region = entry.region
    }
    if ('coordinates' in entry) {
        ordered.coordinates = entry.coordinates
    }

    const remainingKeys = Object.keys(entry).
        filter(
            (key) => ! ['id', 'name', 'country', 'region', 'coordinates'].includes(key)).
        sort((a, b) => a.localeCompare(b))

    for (const key of remainingKeys) {
        ordered[key] = entry[key]
    }

    return ordered
}

async function main () {
    const files = (await readdir(dataDir)).filter(
        (file) => file.endsWith('.json')).sort((a, b) => a.localeCompare(b))

    let updatedFiles = 0
    let generatedIds = 0

    for (const file of files) {
        const fullPath = path.join(dataDir, file)
        const raw = await readFile(fullPath, 'utf8')
        const parsed = JSON.parse(raw)

        if (!Array.isArray(parsed)) {
            throw new Error(`Expected "${file}" to contain an array`)
        }

        const normalized = []

        for (const entry of parsed) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                normalized.push(entry)
                continue
            }

            if (!isUuidV7(entry.id)) {
                entry.id = uuidv7()
                generatedIds += 1
            }

            normalized.push(reorderEntry(entry))
        }

        const sorted = [...normalized].sort(sortByName)
        const nextRaw = `${JSON.stringify(sorted, null, 4)}\n`

        if (raw !== nextRaw) {
            await writeFile(fullPath, nextRaw, 'utf8')
            updatedFiles += 1
        }
    }

    reportInfo(
        `Processed ${files.length} file(s). Updated ${updatedFiles}. Generated ${generatedIds} id(s).`)

    if (generatedIds > 0) {
        reportWarning(`Generated ${generatedIds} UUIDv7 id(s) while formatting data.`)
    }
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    reportError(message)
    process.exitCode = 1
})
