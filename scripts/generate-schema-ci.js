import { exec } from 'node:child_process'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { reportError, reportInfo } from './utils.js'

const execAsync = promisify(exec)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const schemaPath = path.resolve(__dirname, '..', 'schema.json')

function setRequiredIdPolicy (schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
        throw new Error('schema.json must contain a JSON object')
    }

    if (!schema.items || typeof schema.items !== 'object' ||
        Array.isArray(schema.items)) {
        throw new Error('schema.json must define an object in "items"')
    }

    if (!Array.isArray(schema.items.required)) {
        throw new Error('schema.json must define an array in "items.required"')
    }

    const required = schema.items.required.filter(
        (field) => typeof field === 'string')
    const withoutId = required.filter((field) => field !== 'id')

    schema.items.required = withoutId
}

async function validateGeneratedSchema (tempSchemaPath) {
    const quotedSchemaPath = JSON.stringify(tempSchemaPath)
    const command = `npx z-schema ${quotedSchemaPath} data/*.json`

    try {
        await execAsync(command, { cwd: projectRoot })
    }
    catch (error) {
        const stderr = typeof error?.stderr === 'string'
            ? error.stderr.trim()
            : ''
        const stdout = typeof error?.stdout === 'string'
            ? error.stdout.trim()
            : ''
        const fallback = error instanceof Error ? error.message : String(error)
        throw new Error(stderr || stdout || fallback)
    }
}

async function main () {
    const rawSchema = await readFile(schemaPath, 'utf8')
    const schema = JSON.parse(rawSchema)
    const tempDir = await mkdtemp(path.join(tmpdir(), 'keep-data-schema-ci-'))
    const tempSchemaPath = path.join(tempDir, 'schema-ci.tmp.json')

    try {
        setRequiredIdPolicy(schema)
        const schemaContents = JSON.stringify(schema)
        await writeFile(tempSchemaPath, schemaContents, 'utf8')
        await validateGeneratedSchema(tempSchemaPath)
    }
    finally {
        await rm(tempDir, { recursive: true, force: true })
    }

    reportInfo('Validated JSON files against CI schema.')
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    reportError(message)
    process.exitCode = 1
})
