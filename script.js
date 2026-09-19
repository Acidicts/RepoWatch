import * as api from './api.js';

const LANGUAGE_COLORS = {
  bash: '#89E051',
  c: '#555555',
  clojure: '#DB5855',
  cpp: '#F34B7D',
  csharp: '#178600',
  css: '#563D7C',
  dart: '#00B4AB',
  elixir: '#6E4A7E',
  git: '#181717',
  go: '#00ADD8',
  haskell: '#5E5086',
  html: '#E34C26',
  java: '#B07219',
  javascript: '#F1E05A',
  json: '#292929',
  kotlin: '#A97BFF',
  lua: '#000080',
  markdown: '#083FA1',
  perl: '#0298C3',
  php: '#4F5D95',
  python: '#3572A5',
  r: '#198CE7',
  ruby: '#CC342D',
  erb: '#CC342D',
  rust: '#DEA584',
  scala: '#C22D40',
  shell: '#89E051',
  sql: '#E38C00',
  swift: '#F05138',
  typescript: '#3178C6',
  yaml: '#CB171E',
  unknown: '#999999',
};

const LANGUAGE_EXTENSIONS = {
  bash: ['.sh', '.bash'],
  c: ['.c', '.h'],
  clojure: ['.clj', '.cljs', '.cljc', '.edn'],
  cpp: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'],
  csharp: ['.cs', '.csx'],
  css: ['.css'],
  dart: ['.dart'],
  elixir: ['.ex', '.exs'],
  erb: ['.erb'],
  git: ['.gitignore', '.gitattributes'],
  go: ['.go'],
  haskell: ['.hs', '.lhs'],
  html: ['.html', '.htm'],
  java: ['.java'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  json: ['.json'],
  kotlin: ['.kt', '.kts'],
  lua: ['.lua'],
  markdown: ['.md', '.markdown'],
  perl: ['.pl', '.pm'],
  php: ['.php', '.phtml'],
  python: ['.py', '.pyw', '.pyi'],
  r: ['.r', '.R'],
  ruby: ['.rb'],
  rust: ['.rs'],
  scala: ['.scala', '.sc'],
  shell: ['.sh', '.zsh', '.ksh'],
  sql: ['.sql'],
  swift: ['.swift'],
  typescript: ['.ts', '.tsx'],
  yaml: ['.yaml', '.yml'],
  unknown: [],
}

const tbody = document.getElementById("commit-list");
const commitTemplate = document.getElementById("commit-list-template");

var focusedCommit = ''
var commitItems = new Array();

class Commit {
  constructor(sha, title, date, time, linesAdded, linesDeleted, filesChanged, languageBreakdown, actionsStatus, committerIconUrl, committerName, commitUrl) {
    this.sha = sha;
    this.title = title;
    this.date = date;
    this.time = time;
    this.linesAdded = linesAdded;
    this.linesDeleted = linesDeleted;
    this.filesChanged = filesChanged;
    this.languageBreakdown = languageBreakdown;
    this.actionsStatus = actionsStatus;
    this.committerIconUrl = committerIconUrl;
    this.committerName = committerName;
    this.commitUrl = commitUrl;
    this.actionStatuses = {}
  }

  updateActionsStatus(newStatus) {
    this.actionsStatus = newStatus;
  }

  async getActionsStatus() {
    let ciData;
    try {
      const [owner, repo] = getRepoInfo()
      if (!owner || !repo) return;
      ciData = await api.getCIStatus(owner, repo, this.sha)
    } catch (err) {
      // Rate limits propagate so the UI can warn; missing CI just leaves
      // the per-check list empty instead of breaking the focused view.
      if (err && err.isRateLimit) throw err;
      console.warn(`Could not load check-runs for ${this.sha}:`, err);
      return;
    }
    if (!ciData) return;

    for (const checkRun of ciData["check_runs"] || []) {
      let complete = true;
      let failed = false;
      if (["queued", "in_progress", "waiting", "requested", "pending"].includes(checkRun["status"])) {
        complete = false;
      }
      if (checkRun["status"] === "completed" && ["failure", "timed_out", "cancelled", "action_required"].includes(checkRun["conclusion"])) {
        failed = true;
      }
      this.actionStatuses[checkRun["name"]] = [failed ? "red" : (complete ? "green" : "yellow"), checkRun["details_url"]];
    }
  }

  usableUrl() {
    const match = this.commitUrl.match(
      /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/git\/commits\/([0-9a-f]+)$/
    );

    if (!match) {
      throw new Error("URL does not match expected GitHub commit API format");
    }

    const [, owner, repo, sha] = match;

    return `https://github.com/${owner}/${repo}/commit/${sha}`;
  }
}

function toHumanString(str) {
  return str
    .replace(/^[\s_]+|[\s_]+$/g, '')
    .replace(/[_\s]+/g, ' ')
    .replace(/^[a-z]/, m => m.toUpperCase());
}

const EXTENSION_TO_LANGUAGE = Object.entries(LANGUAGE_EXTENSIONS).reduce((map, [lang, exts]) => {
  for (const ext of exts) map[ext] = lang;
  return map;
}, {});

function makeConicGradient(data, options = {}) {
  const { position = 'center', from = '0deg' } = options;

  const entries = Object.entries(data || {});
  const total = entries.reduce((sum, [, v]) => sum + v, 0);

  if (entries.length === 0 || total <= 0) {
    // Fall back to a neutral "unknown" wedge instead of throwing, so a
    // commit with no usable file/language data still renders.
    return makeConicGradient({ unknown: 1 }, options);
  }

  let cumulative = 0;
  const stops = [];
  const segments = [];

  entries.forEach(([lang, value]) => {
    const color =
      LANGUAGE_COLORS[lang.toLowerCase()] || LANGUAGE_COLORS.unknown;
    const startPct = (cumulative / total) * 100;
    cumulative += value;
    const endPct = (cumulative / total) * 100;

    stops.push(`${color} ${startPct.toFixed(2)}% ${endPct.toFixed(2)}%`);

    segments.push({ lang, value, startPct, endPct, color });
  });

  const gradient = `conic-gradient(from ${from} at ${position}, ${stops.join(', ')})`;
  return { gradient, segments, total };
}

// Single tooltip element portaled to <body>. Per-chart absolutely-positioned
// tooltips get clipped by .commit-list's vertical scroll container (a
// scroll/visible overflow combo computes to auto), producing horizontal
// scrollbars instead of overlaying. A fixed-position body-level tooltip
// always renders on top of parent divs.
const globalChartTooltip = document.createElement('span');
globalChartTooltip.className = 'commit-pi-chart-tooltip commit-pi-chart-tooltip--global';
globalChartTooltip.setAttribute('role', 'tooltip');
document.body.appendChild(globalChartTooltip);

function placeGlobalTooltip(anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  globalChartTooltip.style.left = `${rect.left + rect.width / 2}px`;
  globalChartTooltip.style.top = `${rect.top - 8}px`;
}

function showGlobalTooltip(label, anchorEl) {
  globalChartTooltip.textContent = label;
  globalChartTooltip.classList.add('is-visible');
  placeGlobalTooltip(anchorEl);
}

function hideGlobalTooltip() {
  globalChartTooltip.classList.remove('is-visible');
}

// Keep the tooltip glued to its chart while visible; otherwise hide it so a
// stale tooltip never lingers after scrolling.
window.addEventListener('scroll', hideGlobalTooltip, true);
window.addEventListener('resize', hideGlobalTooltip);

// Builds the invisible SVG ring of arcs used purely for hover/tooltip hit-testing,
// and wires each segment up to show/hide the portaled global tooltip element.
function buildHitLayer(svgEl, segments, total) {
  const size = 34;         // matches viewBox / element size
  const radius = size / 2; // full radius so the stroke hit-area covers the visible ring
  const strokeWidth = size; // fat stroke = solid pie wedge coverage
  const circumference = 2 * Math.PI * (radius / 2); // circle drawn at half-radius so stroke fills 0..radius

  const cx = size / 2;
  const cy = size / 2;
  const r = radius / 2;

  svgEl.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svgEl.innerHTML = '';

  const svgNS = 'http://www.w3.org/2000/svg';
  // Anchor positioning to the chart box so the tooltip stays centered above
  // it regardless of which segment is hovered.
  const anchorEl = svgEl.closest('.commit-pi-chart, .focused-commit-pi-chart') || svgEl;

  segments.forEach(seg => {
    const fraction = (seg.endPct - seg.startPct) / 100;
    const dash = fraction * circumference;
    const gap = circumference - dash;
    const offset = -((seg.startPct / 100) * circumference);

    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', r);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'transparent');
    circle.setAttribute('stroke-width', strokeWidth);
    circle.setAttribute('stroke-dasharray', `${dash} ${gap}`);
    circle.setAttribute('stroke-dashoffset', offset);
    circle.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
    circle.style.pointerEvents = 'stroke';
    circle.style.cursor = 'pointer';
    circle.tabIndex = 0;

    const pct = fraction * 100 <= 0 ? 0 : (seg.endPct - seg.startPct).toFixed(1);
    const label = `${toHumanString(seg.lang)} ${pct}%`;

    const showTooltip = () => showGlobalTooltip(label, anchorEl);
    const hideTooltip = () => hideGlobalTooltip();

    circle.addEventListener('mouseenter', showTooltip);
    circle.addEventListener('mouseleave', hideTooltip);
    circle.addEventListener('focus', showTooltip);
    circle.addEventListener('blur', hideTooltip);

    svgEl.appendChild(circle);
  });
}

function renderPiChart(container, data, options = {}) {
  const { gradient, segments, total } = makeConicGradient(data, options);

  const chart = document.createElement('div');
  chart.className = 'commit-pi-chart';
  chart.style.background = gradient;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('commit-pi-chart-hitlayer');
  chart.appendChild(svg);

  const center = document.createElement('div');
  center.className = 'commit-pi-chart-center';
  chart.appendChild(center);

  buildHitLayer(svg, segments, total);

  container.appendChild(chart);
  return chart;
}

function GFG(str, maxLength, suffix = '...') {
  if (str.length > maxLength) {
    return str.substring(0, maxLength) + suffix;
  }
  return str;
}

function addCommit(sha, title, date, linesAdded, linesDeleted, filesChanged, languageBreakdown, actionsStatus, committerIconUrl, url) {
  const clone = document.importNode(commitTemplate.content, true);

  const chartEl = clone.querySelector(".commit-pi-chart");
  const { gradient, segments, total } = makeConicGradient(languageBreakdown);
  chartEl.style.background = gradient;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('commit-pi-chart-hitlayer');

  clone.querySelector(".commit-pi-chart-center-actions-status").style.backgroundColor = actionsStatus;

  chartEl.insertBefore(svg, chartEl.querySelector('.commit-pi-chart-center'));

  buildHitLayer(svg, segments, total);

  const commitEl = clone.querySelector(".commit");
  commitEl.dataset.sha = sha;
  commitEl.addEventListener("click", () => selectCommit(getCommitBySha(sha)));

  clone.querySelector(".commit-list-item-title").textContent = GFG(title, 50, "...");
  clone.querySelector(".commit-list-item-date").textContent = date;
  clone.querySelector(".commit-list-item-line-changes-added").textContent = linesAdded;
  clone.querySelector(".commit-list-item-line-changes-removed").textContent = linesDeleted;
  clone.querySelector(".commit-list-item-file-changed").textContent = `${filesChanged} files changed`;
  clone.querySelector(".commit-list-item-sha").textContent = GFG(sha, 7, "");
  clone.querySelector(".commit-list-item-sha").href = commitItems.find(c => c.sha === sha).usableUrl();
  tbody.appendChild(clone);
}

function getRepoInfo() {
  const el = document.getElementById("repo_input");
  const raw = (el ? el.value : "").trim().replace(/\/+$/, "");
  if (!raw) return [null, null];
  // Accept a pasted GitHub URL as well as "owner/repo".
  const urlMatch = raw.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/i);
  if (urlMatch) return [urlMatch[1], urlMatch[2]];
  const parts = raw.split("/");
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
    return [null, null];
  }
  return [parts[0].trim(), parts[1].trim()];
}

// User-facing message for GitHub API failures. Distinguishes the three
// common 403 causes: quota exhausted, bad/missing token scope, and
// forbidden repo access.
function formatApiError(error, repoLabel) {
  if (error && error.isRateLimit) {
    const reset = error.rateReset ? new Date(Number(error.rateReset) * 1000).toLocaleTimeString() : null;
    return `GitHub API rate limit exceeded${reset ? ` (resets ${reset})` : ""}. ` +
      `Without a token you get 60 requests/hour — one full load costs ~21 requests. ` +
      `Add a personal access token in Settings to get 5,000/hour, then try again.`;
  }
  if (error && (error.status === 401 || error.status === 403)) {
    if (hasGithubKey()) {
      return `GitHub refused the request (${error.status}) for "${repoLabel}". ` +
        `Your token may be expired or missing access to this repo. Check the token in Settings and try again.`;
    }
    return `GitHub refused the request (${error.status}) for "${repoLabel}". ` +
      `The repo may be private (needs a token) or the unauthenticated quota is exhausted. ` +
      `Add a token in Settings and try again.`;
  }
  if (error && error.status === 404) {
    return `Repository "${repoLabel}" was not found. Check the owner/repo spelling.`;
  }
  return `Error fetching commits for "${repoLabel}". ${error && error.message ? error.message : error}`;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  const options = { day: 'numeric', month: 'long', year: 'numeric' };
  return date.toLocaleDateString(undefined, options);
}

function formatTime(dateString) {
  const date = new Date(dateString);
  const options = { hour: 'numeric', minute: 'numeric' };
  return date.toLocaleTimeString(undefined, options);
}

function fileToLang(files) {
  const langMap = {};

  if (!files || files.length === 0) {
    // Merge commits / large diffs can come back with no files array at all
    return { unknown: 1 };
  }

  for (const file of files) {
    const ext = '.' + (file.filename.split('.').pop() || '');
    const lang = EXTENSION_TO_LANGUAGE[ext] || 'unknown';
    const additions = Number(file["additions"]) || 0;
    const deletions = Number(file["deletions"]) || 0;
    langMap[lang] = (langMap[lang] || 0) + additions + deletions;
  }

  const total = Object.values(langMap).reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    // All changes had 0 additions/deletions (e.g. mode-only or binary changes)
    return { unknown: 1 };
  }

  return langMapToLangBreakdown(langMap);
}

function langMapToLangBreakdown(langMap) {
  const total = Object.values(langMap).reduce((sum, value) => sum + value, 0);
  const breakdown = {};
  for (const [lang, value] of Object.entries(langMap)) {
    breakdown[lang] = value / total;
  }
  return breakdown;
}

// Computes the traffic-light status ("red" | "yellow" | "green" | "gray") for
// a single commit's CI checks. Shared by getCommits (initial load) and
// updateAllCommits (periodic refresh of still-pending commits).
// "gray" = CI unavailable (repo has no checks, or a non-quota 403/404).
// Rate-limit errors rethrow so the caller can stop and warn instead of
// painting every commit gray.
async function getCiStatusForCommit(owner, repo, sha) {
  let ciData;
  try {
    ciData = await api.getCIStatus(owner, repo, sha);
  } catch (err) {
    if (err && err.isRateLimit) throw err;
    console.warn(`CI status unavailable for ${sha}, treating as unknown:`, err);
    return "gray";
  }
  const runs = ciData["check_runs"] || [];
  if (runs.length === 0) return "gray";
  let complete = true;
  let failed = false;
  for (const checkRun of runs) {
    if (["queued", "in_progress", "waiting", "requested", "pending"].includes(checkRun["status"])) {
      complete = false;
    }
    if (checkRun["status"] === "completed" && ["failure", "timed_out", "cancelled", "action_required"].includes(checkRun["conclusion"])) {
      failed = true;
    }
    // console.log(`Check run ${checkRun["name"]} for commit ${sha}: status=${checkRun["status"]}, conclusion=${checkRun["conclusion"]}`);
  }
  return failed ? "red" : (complete ? "green" : "yellow");
}

async function getCommits() {
  const [owner, repo] = getRepoInfo();
  if (!owner || !repo) {
    throw new Error('Enter a repo as "owner/repo" (e.g. Acidicts/RepoWatch) before loading.');
  }
  // 10 list entries x (1 detail + 1 check-runs) + 1 list call = ~21 requests.
  // The old default of 30 cost ~61 requests and blew the 60/hr anonymous
  // quota on the very first click (surfaced as a bare 403).
  const commits = await api.getCommits(owner, repo, 10);
  for (const commit_obj of commits) {
    const sha = commit_obj["sha"];
    let commitData;
    try {
      commitData = await api.getCommit(owner, repo, sha);
    } catch (err) {
      if (err && err.isRateLimit) throw err;
      console.warn(`Skipping commit ${sha} (detail fetch failed):`, err);
      continue;
    }
    const files = commitData["files"] || [];

    // Fetch CI status while building the commit so it's created with the
    // correct status right away, instead of defaulting to "yellow".
    // getCiStatusForCommit returns "gray" for repos without CI and only
    // throws on rate limits.
    let actionsStatus = "gray";
    try {
      actionsStatus = await getCiStatusForCommit(owner, repo, sha);
    } catch (err) {
      if (err && err.isRateLimit) throw err;
    }

    const commit = createCommit(
      commitData["sha"],
      commitData["commit"]["message"],
      formatDate(commitData["commit"]["author"]["date"]),
      formatTime(commitData["commit"]["author"]["date"]),
      commitData["stats"]?.["additions"] ?? 0,
      commitData["stats"]?.["deletions"] ?? 0,
      files.length,
      fileToLang(files),
      actionsStatus,
      commitData["author"]?.["avatar_url"] ?? "",
      commitData["commit"]["author"]["name"],
      commitData["commit"]["url"]
    );

    // console.log(`Commit ${commit.sha} added to commitItems.`);
    addCommit(commit.sha, commit.title, commit.date, commit.linesAdded, commit.linesDeleted, commit.filesChanged, commit.languageBreakdown, commit.actionsStatus, commit.committerIconUrl, commit.usableUrl());
    // console.log(`Commit ${commit.sha} added to screen.`);
  }
}

function sortCommits() {
  commitItems.sort((a, b) => new Date(b.date) - new Date(a.date));
  drawAllCommits();
}

function createCommit(sha, title, date, time, linesAdded, linesDeleted, filesChanged, languageBreakdown, actionsStatus, committerIconUrl, committerName, commitUrl) {
  const commit = new Commit(sha, title, date, time, linesAdded, linesDeleted, filesChanged, languageBreakdown, actionsStatus, committerIconUrl, committerName, commitUrl);
  commitItems.push(commit);
  return commit;
}

function clearCommits() {
  tbody.innerHTML = '';
  commitItems = new Array();
}

async function updateCiData(commit) {
  try {
    const [owner, repo] = getRepoInfo();
    if (!owner || !repo) return;
    const status = await getCiStatusForCommit(owner, repo, commit.sha);
    const item = commitItems.find(c => c.sha === commit.sha);
    if (item) item.updateActionsStatus(status);
  } catch (err) {
    // Rate limit or network failure: keep the old dot, don't crash polling.
    console.warn(`Could not refresh CI for ${commit.sha}:`, err);
  }
}

async function updateAllCommits() {
  const items = commitItems.filter(c => c.actionsStatus === "yellow");
  for (const commit of items) {
    await updateCiData(commit);
  }
}

function drawAllCommits() {
  tbody.innerHTML = '';
  for (const commit of commitItems) {
    addCommit(commit.sha, commit.title, commit.date, commit.linesAdded, commit.linesDeleted, commit.filesChanged, commit.languageBreakdown, commit.actionsStatus, commit.committerIconUrl, commit.commitUrl);
  }
}

function getCommitBySha(sha) {
  return commitItems.find(item => item.sha === sha);
}

function setCookie(name, value, days) {
  let expires = "";
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    expires = "; expires=" + date.toUTCString();
  }
  document.cookie = name + "=" + encodeURIComponent(value) + expires + "; path=/";
}

function getCookie(name) {
  const cname = name + "=";
  const cookies = document.cookie.split(";");
  for (let c of cookies) {
    c = c.trim();
    if (c.indexOf(cname) === 0) {
      return decodeURIComponent(c.substring(cname.length));
    }
  }
  return null;
}

function deleteCookie(name) {
  document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/";
}

function hasGithubKey() {
  const el = document.getElementById("github_key");
  return el && el.value.trim() !== "";
}

const focusedCommitContainer = document.getElementById("focused-commit");
const focusedCommitTemplate = document.getElementById("focused-commit-template");
const workflowStatusTemplate = document.getElementById("workflow-status");

function addWorkflow(name, value, workflowStatusContainer, url) {
  const clone = document.importNode(workflowStatusTemplate.content, true);
  const wrapper = clone.querySelector(".commit-focused-workflow-status");

  clone.querySelector(".commit-focused-workflow-status__indicator").style.backgroundColor = value;
  clone.querySelector(".commit-focused-workflow-status__name").textContent = name;

  wrapper.addEventListener("click", async () => {
    window.open(url, '_blank');
  })
  workflowStatusContainer.appendChild(clone)
}

async function renderFocusedCommitWorkflows(commit, clone) {
  clone.querySelector(".focused-commit-workflows").innerHTML = '';

  try {
    await commit.getActionsStatus();
  } catch (err) {
    // Rate-limited: leave the workflow list empty instead of breaking the
    // whole focused-commit render.
    console.warn(`Could not load workflows for ${commit.sha}:`, err);
    return;
  }
  for (const [name, value] of Object.entries(commit.actionStatuses)) {
    addWorkflow(name, value[0], clone.querySelector(".focused-commit-workflows"), value[1])
  }
}

async function renderFocusedCommit(commit) {
  if (!commit) return;
  focusedCommitContainer.innerHTML = '';
  focusedCommit = commit.sha;
  const clone = document.importNode(focusedCommitTemplate.content, true);

  const chartEl = clone.querySelector(".focused-commit-pi-chart");
  const { segments, total } = makeConicGradient(commit.languageBreakdown);
  chartEl.style.background = makeConicGradient(commit.languageBreakdown).gradient;

  const svg = clone.querySelector(".focused-commit-pi-chart-hitlayer");
  buildHitLayer(svg, segments, total);

  clone.querySelector(".focused-commit-text").textContent = commit.title;
  clone.querySelector(".focused-committer-image").src = commit.committerIconUrl;
  clone.querySelector(".focused-commit-meta-sha").textContent = GFG(commit.sha, 7, "");
  clone.querySelector(".focused-commit-meta-sha").href = commit.usableUrl();
  clone.querySelector(".focused-commit-meta-date").textContent = commit.date;
  clone.querySelector(".focused-commiter-name").textContent = commit.committerName;
  clone.querySelector(".focused-commit-changes-added").textContent = commit.linesAdded;
  clone.querySelector(".focused-commit-changes-removed").textContent = commit.linesDeleted;
  clone.querySelector(".focused-commit-files").textContent = `${commit.filesChanged} files changed`;

  await renderFocusedCommitWorkflows(commit, clone)
  focusedCommitContainer.appendChild(clone);
}

async function selectCommit(commit) {
  if (!commit) return;
  await renderFocusedCommit(commit);
}

async function newCommitExists() {
  // Nothing loaded yet (initial page view before the user presses Go):
  // the Go handler owns the first load, so don't burn API quota here.
  if (commitItems.length === 0) return;
  const [owner, repo] = getRepoInfo();
  if (!owner || !repo) return;
  let commits;
  try {
    commits = await api.getCommits(owner, repo, 10);
  } catch (err) {
    // This was previously an unhandled rejection ("Uncaught (in promise)
    // Error: HTTP error! Status: 403" at script.js:552). Log it and keep
    // polling; the next tick retries.
    console.warn("Background refresh: could not list commits:", err);
    return;
  }
  commits.sort((a, b) => new Date(b.commit.author.date) - new Date(a.commit.author.date));

  const latestDate = new Date(Math.max(...commitItems.map(c => new Date(c.date))));

  // For commits made after the latest commit in commitItems, create a new
  // Commit item and draw it.
  let added = false;
  for (const commit_obj of commits) {
    const sha = commit_obj["sha"];
    if (commitItems.some(c => c.sha === sha)) continue;

    const commitDate = new Date(commit_obj["commit"]["author"]["date"]);
    if (commitDate <= latestDate) break;

    let commitData;
    try {
      commitData = await api.getCommit(owner, repo, sha);
    } catch (err) {
      if (err && err.isRateLimit) {
        console.warn("Background refresh stopped: rate limit exceeded:", err);
        break;
      }
      console.warn(`Background refresh: skipping ${sha} (detail fetch failed):`, err);
      continue;
    }
    const files = commitData["files"] || [];
    let actionsStatus = "gray";
    try {
      actionsStatus = await getCiStatusForCommit(owner, repo, sha);
    } catch (err) {
      if (err && err.isRateLimit) {
        console.warn("Background refresh stopped: rate limit exceeded:", err);
        break;
      }
    }

    const commit = createCommit(
      commitData["sha"],
      commitData["commit"]["message"],
      formatDate(commitData["commit"]["author"]["date"]),
      formatTime(commitData["commit"]["author"]["date"]),
      commitData["stats"]?.["additions"] ?? 0,
      commitData["stats"]?.["deletions"] ?? 0,
      files.length,
      fileToLang(files),
      actionsStatus,
      commitData["author"]?.["avatar_url"] ?? "",
      commitData["commit"]["author"]["name"],
      commitData["commit"]["url"]
    );

    addCommit(commit.sha, commit.title, commit.date, commit.linesAdded, commit.linesDeleted, commit.filesChanged, commit.languageBreakdown, commit.actionsStatus, commit.committerIconUrl, commit.usableUrl());
    added = true;
  }

  if (added) sortCommits();
}

Array.from(document.getElementsByClassName("commit")).forEach(element => {
  element.addEventListener("click", async () => {
    sha = element.aria_id
    selectCommit(getCommitBySha(sha))
  })
});

document.getElementById("repo-input-button").addEventListener("click", async () => {
  clearCommits();
  setCookie("repo_input", document.getElementById("repo_input").value, 7);
  const [owner, repo] = getRepoInfo();
  const repoLabel = owner && repo ? `${owner}/${repo}` : document.getElementById("repo_input").value.trim();
  try {
    if (!owner || !repo) {
      throw new Error('Enter a repo as "owner/repo" (e.g. Acidicts/RepoWatch).');
    }
    if (hasGithubKey()) {
      await api.checkGithubKey();
    }
    await getCommits();
    sortCommits();
    // console.log('Finished drawing', commitItems.length);
  } catch (error) {
    console.warn("Error fetching commits:", error);
    alert(formatApiError(error, repoLabel || "(empty)"));
    const settingsModal = document.getElementById("settings-modal");
    settingsModal.showModal();
  }
});

document.getElementById("save-settings").addEventListener("click", async () => {
  const key = document.getElementById("github_key").value.trim();
  // Empty token = unauthenticated mode (60 req/hr). Clear any saved key
  // and close without validating.
  if (key === "") {
    deleteCookie("github_key");
    document.getElementById("settings-modal").close();
    alert("No token saved — using unauthenticated mode (60 requests/hour). Add a token anytime to raise the limit.");
    return;
  }
  try {
    await api.checkGithubKey();
    document.getElementById("settings-modal").close();
    setCookie("github_key", key, 7);
    alert("Success, the GitHub key is valid.");
  } catch (error) {
    console.error("Invalid GitHub key:", error);
    alert("Invalid GitHub key. Please check and try again.");
  }
});

document.getElementById("settings-button").addEventListener('click', () => {
  const settingsModal = document.getElementById("settings-modal");
  settingsModal.showModal();
});

document.querySelector(".settings-modal-close-button").addEventListener('click', () => {
  const settingsModal = document.getElementById("settings-modal");
  settingsModal.close();
});

document.getElementById("toggle-guide").addEventListener('click', () => {
  const guide = document.getElementById("pat-guide");
  const btn = document.getElementById("toggle-guide");
  const isHidden = guide.hidden;
  guide.hidden = !isHidden;
  btn.textContent = isHidden ? "Hide guide" : "Need a token? How to get one";
});

document.addEventListener("DOMContentLoaded", function () {
  const repoInput = document.getElementById("repo_input");
  const githubKey = document.getElementById("github_key");

  const savedRepo = getCookie("repo_input");
  if (savedRepo) {
    repoInput.value = savedRepo;
  }

  const savedKey = getCookie("github_key");
  if (savedKey) {
    githubKey.value = savedKey;
  }
});

async function updatePage() {
  try {
    await newCommitExists();
  } catch (err) {
    console.warn("Background refresh failed:", err);
  }
  if (focusedCommit != "") {
    const commit = getCommitBySha(focusedCommit);
    if (!commit) return;
    try {
      await renderFocusedCommit(commit);
    } catch (err) {
      console.warn("Could not re-render focused commit:", err);
    }
  }
}

window.onload = function () {
  updatePage();

  setInterval(updatePage, 300000);
};