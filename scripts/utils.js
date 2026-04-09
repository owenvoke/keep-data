function escapeGitHubAnnotation (value) {
    return String(value).
        replaceAll('%', '%25').
        replaceAll('\r', '%0D').
        replaceAll('\n', '%0A')
}

export const isGitHubActions = process.env.GITHUB_ACTIONS === 'true'

export function githubError (message) {
    if (!isGitHubActions) {
        return
    }

    console.error(`::error::${escapeGitHubAnnotation(message)}`)
}

export function githubWarning (message) {
    if (!isGitHubActions) {
        return
    }

    console.warn(`::warning::${escapeGitHubAnnotation(message)}`)
}

export function githubNotice (message) {
    if (!isGitHubActions) {
        return
    }

    console.log(`::notice::${escapeGitHubAnnotation(message)}`)
}

export function reportError (message) {
    if (isGitHubActions) {
        githubError(message)
        return
    }

    console.error(message)
}

export function reportWarning (message) {
    if (isGitHubActions) {
        githubWarning(message)
        return
    }

    console.warn(message)
}

export function reportInfo (message) {
    if (isGitHubActions) {
        githubNotice(message)
        return
    }

    console.log(message)
}
