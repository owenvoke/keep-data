import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { reportError, reportInfo } from './utils.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const dataDir = path.join(rootDir, 'data')
const regionFilePattern = /^([a-z]{2})-([a-z0-9]+)\.json$/i
const countryFilePattern = /^[a-z]{2}\.json$/i
const allFileName = 'all.json'
const countryDisplayNames = new Intl.DisplayNames(['en'], { type: 'region' })

const regionNameByCode = {
    'gb-eng': 'England',
    'gb-nir': 'Northern Ireland',
    'gb-sct': 'Scotland',
    'gb-wls': 'Wales',
}

function sortByName (a, b) {
    return String(a?.name ?? '').localeCompare(String(b?.name ?? ''), 'en', {
        sensitivity: 'base',
    })
}

function toCountryName (countryCode) {
    const normalized = countryCode.toUpperCase()
    return countryDisplayNames.of(normalized) ?? normalized
}

function toRegionName (regionCode) {
    const normalized = regionCode.toLowerCase()
    if (regionNameByCode[normalized]) {
        return regionNameByCode[normalized]
    }

    const parts = normalized.split('-')
    if (parts.length === 2) {
        return parts[1].toUpperCase()
    }

    return regionCode.toUpperCase()
}

async function main () {
    const files = (await readdir(dataDir)).
        filter((file) => file.endsWith('.json')).
        sort((a, b) => a.localeCompare(b))

    const regionFiles = files.
        filter((file) => file !== allFileName).
        filter((file) => !countryFilePattern.test(file)).
        filter((file) => regionFilePattern.test(file))

    const countries = new Map()

    for (const file of regionFiles) {
        const regionMatch = file.match(regionFilePattern)
        if (!regionMatch) {
            continue
        }

        const countryCode = regionMatch[1].toLowerCase()
        const regionSuffix = regionMatch[2].toLowerCase()
        const fileBase = file.replace(/\.json$/i, '')
        const regionCode = `${countryCode}-${regionSuffix}`
        const fullPath = path.join(dataDir, file)
        const parsed = JSON.parse(await readFile(fullPath, 'utf8'))

        if (!Array.isArray(parsed)) {
            throw new Error(`Expected "${file}" to contain an array`)
        }

        if (!countries.has(countryCode)) {
            countries.set(countryCode, {
                code: countryCode,
                name: toCountryName(countryCode),
                regions: [],
                entries: [],
            })
        }

        const country = countries.get(countryCode)
        country.regions.push({
            code: regionCode,
            name: toRegionName(regionCode),
            fileBase,
        })
        country.entries.push(...parsed)
    }

    const countryList = Array.from(countries.values()).
        sort((a, b) => a.code.localeCompare(b.code))

    for (const country of countryList) {
        country.regions.sort((a, b) => a.code.localeCompare(b.code))
        country.entries.sort(sortByName)
        const outputPath = path.join(dataDir, `${country.code}.json`)
        await writeFile(outputPath, `${JSON.stringify(country.entries, null, 4)}\n`, 'utf8')
    }

    const allFiles = (await readdir(dataDir)).
        filter((file) => file !== allFileName).
        filter((file) => countryFilePattern.test(file)).
        sort((a, b) => a.localeCompare(b))

    const allEntries = []
    for (const file of allFiles) {
        const parsed = JSON.parse(await readFile(path.join(dataDir, file), 'utf8'))
        if (!Array.isArray(parsed)) {
            throw new Error(`Expected "${file}" to contain an array`)
        }
        allEntries.push(...parsed)
    }

    allEntries.sort(sortByName)
    await writeFile(path.join(dataDir, allFileName), `${JSON.stringify(allEntries)}\n`, 'utf8')

    const hashFile = async (file) => {
        const content = await readFile(path.join(dataDir, file))
        return createHash('sha1').update(content).digest('hex')
    }

    const meta = {hashes: {}, countries: [], regions: []}
    meta.hashes[allFileName] = await hashFile(allFileName)
    for (const file of allFiles) {
        meta.hashes[file] = await hashFile(file)
        meta.countries.push(file.replace('.json', '').toUpperCase())
    }
    for (const file of regionFiles) {
        meta.hashes[file] = await hashFile(file)
        meta.regions.push(file.replace('.json', '').toUpperCase())
    }
    await writeFile(path.join(dataDir, '.meta.json'), `${JSON.stringify(meta)}\n`, 'utf8')

    reportInfo(
        `Aggregated ${countryList.length} country file(s) from ${regionFiles.length} region file(s). Generated data/all.json from ${allFiles.length} country file(s).`)
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    reportError(message)
    process.exitCode = 1
})
