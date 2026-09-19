function getToken() {
    const el = document.getElementById("github_key");
    const raw = el ? el.value : "";
    const token = (raw || "").trim();
    return token || null;
}

function authHeaders() {
    const headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10"
    };
    const token = getToken();
    // Only send Authorization when a token is provided, otherwise fall
    // back to GitHub's unauthenticated 60 req/hr rate limit.
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
}

// Read GitHub rate-limit headers without consuming the response body.
function rateLimitInfo(response) {
    return {
        remaining: response.headers.get("x-ratelimit-remaining"),
        limit: response.headers.get("x-ratelimit-limit"),
        reset: response.headers.get("x-ratelimit-reset"),
    };
}

function resetTimeString(reset) {
    const epoch = Number(reset);
    if (!epoch) return null;
    return new Date(epoch * 1000).toLocaleTimeString();
}

async function readErrorDetail(response) {
    try {
        const text = await response.text();
        if (!text) return "";
        try {
            const data = JSON.parse(text);
            return data.message || text;
        } catch {
            return text;
        }
    } catch {
        return "";
    }
}

function isRateLimitStatus(status, remaining, detail) {
    if (status === 429) return true;
    if (status !== 403) return false;
    if (remaining === "0") return true;
    return /rate limit|quota|exceeded/i.test(detail || "");
}

// Throw a rich Error carrying status / rate-limit info so callers can tell
// "quota exhausted — add a token and retry later" apart from "no CI / no
// access" (a plain 403/404 from check-runs on repos without Actions).
async function throwForResponse(response, context) {
    const { remaining, limit, reset } = rateLimitInfo(response);
    const detail = await readErrorDetail(response);
    const rateLimited = isRateLimitStatus(response.status, remaining, detail);
    const resetStr = resetTimeString(reset);
    let message = `GitHub API error ${response.status} (${context})`;
    if (detail) message += `: ${detail}`;
    if (rateLimited) {
        message += resetStr
            ? ` — rate limit exceeded (${remaining}/${limit} left, resets ${resetStr}). Add a personal access token in Settings to raise the quota.`
            : ` — rate limit exceeded. Add a personal access token in Settings to raise the quota.`;
    }
    const err = new Error(message);
    err.status = response.status;
    err.detail = detail;
    err.isRateLimit = rateLimited;
    err.rateRemaining = remaining;
    err.rateLimit = limit;
    err.rateReset = reset;
    err.context = context;
    throw err;
}

async function checkGithubKey() {
    const token = getToken();
    // No key = unauthenticated mode (60/hr). Nothing to validate.
    if (!token) {
        return null;
    }
    const response = await fetch("https://api.github.com/user", {
        method: "GET",
        headers: authHeaders()
    });

    if (!response.ok) {
        await throwForResponse(response, "validate token");
    }

    const data = await response.json();
    return data;
}

// https://api.github.com/repos/OWNER/REPO/commits
// perPage defaults to 10: the old default (30) plus a detail + check-runs
// call per commit cost ~61 requests per load and instantly exhausts the
// 60 req/hr unauthenticated quota (403 on the next call).
async function getCommits(OWNER, REPO, perPage = 10) {
    const n = Math.min(Math.max(Number(perPage) || 10, 1), 30);
    const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/commits?per_page=${n}`, {
        method: "GET",
        headers: authHeaders()
    });

    if (!response.ok) {
        await throwForResponse(response, `list commits for ${OWNER}/${REPO}`);
    }

    const data = await response.json();
    return data;
}

// https://api.github.com/repos/OWNER/REPO/commits/REF
async function getCommit(OWNER, REPO, commitSha) {
    const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/commits/${commitSha}`, {
        method: "GET",
        headers: authHeaders()
    });

    if (!response.ok) {
        await throwForResponse(response, `get commit ${commitSha}`);
    }

    const data = await response.json();
    return data;
}

// https://api.github.com/repos/OWNER/REPO/commits/REF/check-runs
// CI is optional: repos without Actions/checks answer 404, or 403 when the
// token lacks Checks access. Those mean "no CI data" and resolve to an
// empty run list. A 403 that IS a rate limit (remaining == 0) still throws
// so the caller can back off instead of silently showing gray dots.
async function getCIStatus(OWNER, REPO, SHA) {
    const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/commits/${SHA}/check-runs`, {
        method: "GET",
        headers: authHeaders()
    });

    if (response.ok) {
        const data = await response.json();
        return data;
    }

    if (response.status === 404) {
        return { check_runs: [] };
    }

    if (response.status === 403) {
        const { remaining, limit, reset } = rateLimitInfo(response);
        const detail = await readErrorDetail(response);
        if (isRateLimitStatus(403, remaining, detail)) {
            // Build the error directly instead of calling throwForResponse,
            // because readErrorDetail already consumed the response body.
            const resetStr = resetTimeString(reset);
            const context = `check-runs for ${SHA}`;
            let message = `GitHub API error 403 (${context}): ${detail || "forbidden"}`;
            message += resetStr
                ? ` — rate limit exceeded (${remaining}/${limit} left, resets ${resetStr}). Add a personal access token in Settings to raise the quota.`
                : ` — rate limit exceeded. Add a personal access token in Settings to raise the quota.`;
            const err = new Error(message);
            err.status = 403;
            err.detail = detail;
            err.isRateLimit = true;
            err.rateRemaining = remaining;
            err.rateLimit = limit;
            err.rateReset = reset;
            err.context = context;
            throw err;
        }
        console.warn(`check-runs unavailable for ${OWNER}/${REPO}@${SHA} (403, treating as no CI): ${detail}`);
        return { check_runs: [] };
    }

    await throwForResponse(response, `check-runs for ${SHA}`);
}

export { getCommits, getCommit, getCIStatus, checkGithubKey };
