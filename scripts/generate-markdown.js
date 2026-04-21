import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const dataDir = path.resolve(__dirname, '..', 'data')
const readmePath = path.join(rootDir, 'README.md')

const regionFilePattern = /^([a-z]{2})-([a-z0-9]+)\.json$/i
const countryFilePattern = /^[a-z]{2}\.json$/i
const countryDisplayNames = new Intl.DisplayNames(['en'], { type: 'region' })

const regionNameByCode = {
    'gb-eng': 'England',
    'gb-nir': 'Northern Ireland',
    'gb-sct': 'Scotland',
    'gb-wls': 'Wales',
}

function escapeInline (value) {
    return String(value).
        replaceAll('\\', '\\\\').
        replaceAll('|', '\\|').
        replaceAll('\n', '<br>')
}

function formatValue (key, value) {
    if (value === null || value === undefined) {
        return ''
    }

    if (key === 'coordinates' && value && typeof value === 'object' && !Array.isArray(value)) {
        const latitude = value.latitude
        const longitude = value.longitude
        if (latitude !== undefined && longitude !== undefined) {
            return `${escapeInline(latitude)}, ${escapeInline(longitude)}`
        }
    }

    if (key === 'homepage') {
        return `[${escapeInline(value)}](${escapeInline(value)})`
    }

    if (['id', 'country', 'region'].includes(key)) {
        return `\`${escapeInline(value)}\``
    }

    if (key === 'alternativeNames' && Array.isArray(value)) {
        return value.join(', ')
    }

    if (typeof value === 'object') {
        return escapeInline(JSON.stringify(value))
    }

    return escapeInline(value)
}

function toTitleCase (value) {
    const normalized = String(value).
        replace(/([a-z0-9])([A-Z])/g, '$1 $2').
        replaceAll('_', ' ').
        replaceAll('-', ' ').
        split(/\s+/).
        filter(Boolean).
        map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).
        join(' ')

    if (normalized === 'Id') {
        return 'ID'
    }

    return normalized
}

function toEntrySection (entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error('Expected each JSON entry to be an object')
    }

    const rows = Object.entries(entry).map(([key, value]) => {
        const field = `**${escapeInline(toTitleCase(key))}**`
        return `| ${field} | ${formatValue(key, value)} |`
    })

    return [
        `## <a id="${entry.id}"></a> [${entry.name}](#${entry.id})`,
        '',
        '| Field | Value |',
        '| --- | --- |',
        ...rows,
        ''
    ].join('\n')
}

function toDocument (sourceFileName, entries) {
    let title = sourceFileName.replace(/\.json$/i, '')
    const body = entries.map(toEntrySection).join('\n')

    if (title.length === 2) {
        title = `${toCountryName(title)} (\`${title.toUpperCase()}\`)`
    } else if (title.length > 2) {
        const {0: country, 1: region} = title.split('-', 2)
        title = `${toCountryName(country)} / ${region.toUpperCase()} (\`${title.toUpperCase()}\`)`
    }

    return `# ${escapeInline(title)}\n\n${body}`.trimEnd() + '\n'
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

function toCountrySectionMarkdown (countries) {
    const lines = []

    for (const country of countries) {
        lines.push(`- [${country.name}](data/${country.code}) ([JSON](data/${country.code}.json))`)

        for (const region of country.regions) {
            lines.push(`  - [${region.name}](data/${region.fileBase}) ([JSON](data/${region.fileBase}.json))`)
        }
    }

    return lines.join('\n')
}

async function updateReadmeCountriesSection (files) {
    const regionFiles = files.filter((file) => regionFilePattern.test(file))
    const countryFiles = files.filter((file) => countryFilePattern.test(file))
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

        if (!countries.has(countryCode)) {
            countries.set(countryCode, {
                code: countryCode,
                name: toCountryName(countryCode),
                regions: [],
            })
        }

        const country = countries.get(countryCode)
        country.regions.push({
            code: regionCode,
            name: toRegionName(regionCode),
            fileBase,
        })
    }

    for (const file of countryFiles) {
        const countryCode = file.replace(/\.json$/i, '').toLowerCase()

        if (!countries.has(countryCode)) {
            countries.set(countryCode, {
                code: countryCode,
                name: toCountryName(countryCode),
                regions: [],
            })
        }
    }

    const countryList = Array.from(countries.values()).
        sort((a, b) => a.name.localeCompare(b.name))

    for (const country of countryList) {
        country.regions.sort((a, b) => a.name.localeCompare(b.name))
    }

    const readmeRaw = await readFile(readmePath, 'utf8')
    const countriesSection = toCountrySectionMarkdown(countryList)
    const replacement = `<!-- COUNTRIES -->\n${countriesSection}\n<!-- END COUNTRIES -->`
    const nextReadme = readmeRaw.replace(
        /<!-- COUNTRIES -->[\s\S]*?<!-- END COUNTRIES -->/m,
        replacement)

    if (nextReadme !== readmeRaw) {
        await writeFile(readmePath, nextReadme, 'utf8')
    }
}

async function main () {
    const files = (await readdir(dataDir)).
        filter((file) => file.endsWith('.json') && file !== 'all.json').
        sort((a, b) => a.localeCompare(b))

    let written = 0

    for (const file of files) {
        const fullPath = path.join(dataDir, file)
        const raw = await readFile(fullPath, 'utf8')
        const parsed = JSON.parse(raw)

        if (!Array.isArray(parsed)) {
            throw new Error(`Expected "${file}" to contain an array`)
        }

        const markdown = toDocument(file, parsed)
        const outputPath = path.join(dataDir, file.replace(/\.json$/i, '.md'))
        await writeFile(outputPath, markdown, 'utf8')
        written += 1
    }

    await updateReadmeCountriesSection(files)

    console.log(`Generated ${written} Markdown file(s) from data/*.json`)
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
})
