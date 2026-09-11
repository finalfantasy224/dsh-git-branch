/**
 * dsh-git-branch host half — unified multi-repo git branch switching and
 * code updating for one DSH workspace.
 *
 * A DSH workspace directory (e.g. ~/IdeaProjects/sm) typically holds many
 * independent git repositories (one per sub-project). This plugin exposes a
 * small HTTP API on the DSH web server so the browser half can:
 *
 *   POST /dsh-git-branch/status        scan the workspace and report every repo
 *   POST /dsh-git-branch/branch-names  union of local+remote branch names
 *   POST /dsh-git-branch/switch        switch all/selected repos to one branch
 *   POST /dsh-git-branch/pull          update (pull --ff-only) all/selected repos
 *   POST /dsh-git-branch/fetch         fetch --prune all/selected repos
 *
 * Every request names the workspace by absolute path (`ws`); repo selections
 * are directory basenames discovered by the server on each call, so a stale
 * or forged repo name can never escape the workspace directory.
 */
import { execFile, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

/** Plugin row id (matches cordis.patch.yml). */
export const name = 'git-branch'

/** webServer is the only hard dependency; workspaceRegistry is probed lazily. */
export const inject = ['webServer']

/** Route prefix served on the shared DSH web server. */
const ROUTE_PREFIX = '/dsh-git-branch'

/** Per-operation git timeout (ms). */
const TIMEOUT_STATUS_MS = 20_000
const TIMEOUT_SWITCH_MS = 60_000
const TIMEOUT_PULL_MS = 180_000
const TIMEOUT_CLONE_MS = 600_000
const TIMEOUT_PUSH_MS = 300_000

/** Max git processes running at once. */
const CONCURRENCY = 4

/** execFile buffer ceiling (pull summaries can be verbose). */
const MAX_BUFFER = 4 * 1024 * 1024

/** Branch names the switch endpoint accepts (git's own rules are stricter, but this blocks shell/path abuse). */
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/

/** Run one git command in a repo directory and resolve {code, stdout, stderr}. */
function git(cwd, args, timeoutMs) {
  return new Promise((resolveRun) => {
    execFile('git', args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      if (error === null) {
        resolveRun({ code: 0, stdout: stdout ?? '', stderr: stderr ?? '' })
        return
      }
      // git exits non-zero on ordinary refusals; keep the message, not the throw.
      const code = typeof error.code === 'number' ? error.code : 1
      resolveRun({
        code,
        stdout: stdout ?? '',
        stderr: (stderr || error.message || '').slice(0, 4000),
        killed: error.killed === true,
      })
    })
  })
}

/** Map over items with a concurrency ceiling. */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/** First line of a string, trimmed. */
const firstLine = (text) => {
  const newline = text.indexOf('\n')
  return (newline === -1 ? text : text.slice(0, newline)).trim()
}

/**
 * Discover git repositories in a workspace: the workspace root itself (when
 * it is a repo) plus every direct child directory containing a .git entry.
 * Repo `name` is the directory basename; the root repo is named '.'.
 */
function discoverRepos(wsPath) {
  const repos = []
  if (existsSync(join(wsPath, '.git'))) {
    repos.push({ name: '.', path: wsPath })
  }
  let entries = []
  try {
    entries = readdirSync(wsPath, { withFileTypes: true })
  } catch {
    return repos
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    if (entry.name.startsWith('.')) continue
    const childPath = join(wsPath, entry.name)
    try {
      if (existsSync(join(childPath, '.git'))) {
        repos.push({ name: entry.name, path: childPath })
      }
    } catch {
      // unreadable child — skip silently
    }
  }
  repos.sort((a, b) => a.name.localeCompare(b.name))
  return repos
}

/** Resolve a repo selection ('all' or name list) against a fresh discovery. */
function selectRepos(wsPath, selection) {
  const discovered = discoverRepos(wsPath)
  if (selection === 'all' || selection === undefined || selection === null) {
    return { repos: discovered, unknown: [] }
  }
  if (!Array.isArray(selection)) return { repos: [], unknown: [] }
  const byName = new Map(discovered.map(repo => [repo.name, repo]))
  const repos = []
  const unknown = []
  for (const raw of selection) {
    if (typeof raw !== 'string') continue
    const repo = byName.get(raw)
    if (repo === undefined) unknown.push(raw)
    else repos.push(repo)
  }
  return { repos, unknown }
}

/** One repo's live status row. */
async function repoStatus(repo) {
  const row = {
    name: repo.name,
    branch: null,
    detached: false,
    dirty: 0,
    staged: 0,
    untracked: 0,
    ahead: 0,
    behind: 0,
    upstream: null,
    head: null,
    error: null,
  }
  const head = await git(repo.path, ['rev-parse', '--verify', 'HEAD'], TIMEOUT_STATUS_MS)
  if (head.code !== 0) {
    // Empty repo (no commits yet) is still a repo.
    row.branch = firstLine((await git(repo.path, ['branch', '--show-current'], TIMEOUT_STATUS_MS)).stdout) || '(空仓库)'
    return row
  }
  row.head = head.stdout.trim().slice(0, 12)
  const branch = await git(repo.path, ['branch', '--show-current'], TIMEOUT_STATUS_MS)
  row.branch = firstLine(branch.stdout)
  if (row.branch === '') {
    row.detached = true
    row.branch = `(detached @ ${row.head})`
  }
  const porcelain = await git(repo.path, ['status', '--porcelain'], TIMEOUT_STATUS_MS)
  if (porcelain.code === 0) {
    for (const line of porcelain.stdout.split('\n')) {
      if (line.length === 0) continue
      const x = line[0]
      const y = line[1]
      if (x === '?' && y === '?') row.untracked += 1
      else {
        if (x !== ' ' && x !== '?') row.staged += 1
        if (y !== ' ' && y !== '?') row.dirty += 1
      }
    }
  }
  const upstream = await git(repo.path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], TIMEOUT_STATUS_MS)
  if (upstream.code === 0) {
    row.upstream = firstLine(upstream.stdout)
    const counts = await git(repo.path, ['rev-list', '--left-right', '--count', '@{u}...HEAD'], TIMEOUT_STATUS_MS)
    if (counts.code === 0) {
      const parts = counts.stdout.trim().split(/\s+/)
      const behind = Number.parseInt(parts[0] ?? '', 10)
      const ahead = Number.parseInt(parts[1] ?? '', 10)
      row.behind = Number.isFinite(behind) ? behind : 0
      row.ahead = Number.isFinite(ahead) ? ahead : 0
    }
  }
  return row
}

/** Local + remote branch names of one repo (short names, remote segment stripped). */
async function repoBranchNames(repo) {
  const names = new Set()
  const local = await git(repo.path, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], TIMEOUT_STATUS_MS)
  if (local.code === 0) {
    for (const line of local.stdout.split('\n')) {
      const ref = line.trim()
      if (ref !== '') names.add(ref)
    }
  }
  const remote = await git(
    repo.path,
    ['for-each-ref', '--format=%(refname:lstrip=3)', 'refs/remotes'],
    TIMEOUT_STATUS_MS,
  )
  if (remote.code === 0) {
    for (const line of remote.stdout.split('\n')) {
      const ref = line.trim()
      // refname:lstrip=3 drops "refs/remotes/<remote>/"; skip <remote>/HEAD leftovers.
      if (ref === '' || ref === 'HEAD' || ref.endsWith('/HEAD')) continue
      names.add(ref)
    }
  }
  return [...names]
}

/** Whether a branch exists locally in a repo. */
async function hasLocalBranch(repo, branch) {
  const result = await git(repo.path, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], TIMEOUT_STATUS_MS)
  return result.code === 0
}

/** The repo's first configured remote name, or null. */
async function firstRemote(repo) {
  const result = await git(repo.path, ['remote'], TIMEOUT_STATUS_MS)
  if (result.code !== 0) return null
  const remotes = result.stdout.split('\n').map(line => line.trim()).filter(Boolean)
  if (remotes.length === 0) return null
  return remotes.includes('origin') ? 'origin' : remotes[0]
}

/**
 * Whether a repo has uncommitted changes to tracked files (staged or
 * unstaged). Untracked files (`??` porcelain rows) do NOT block `git switch`
 * — git itself refuses only when the target branch would overwrite such a
 * file — so they are excluded from the dirty check to avoid skipping
 * switches over harmless IDE/editor droppings.
 */
async function isDirty(repo) {
  const result = await git(repo.path, ['status', '--porcelain'], TIMEOUT_STATUS_MS)
  if (result.code !== 0) return true // conservative: unable to tell → treat as dirty
  for (const line of result.stdout.split('\n')) {
    if (line === '') continue
    if (line.startsWith('??')) continue
    return true
  }
  return false
}

/** Switch one repo to a branch. */
async function switchRepo(repo, branch, options) {
  const { create = false, allowDirty = false } = options
  if (await isDirty(repo) && !allowDirty) {
    return { repo: repo.name, ok: false, skipped: true, message: '有未提交的修改，已跳过（勾选“允许未提交修改”可强制）' }
  }
  const current = firstLine((await git(repo.path, ['branch', '--show-current'], TIMEOUT_SWITCH_MS)).stdout)
  if (current === branch) {
    return { repo: repo.name, ok: true, skipped: true, message: `已在 ${branch}` }
  }
  if (await hasLocalBranch(repo, branch)) {
    const result = await git(repo.path, ['switch', branch], TIMEOUT_SWITCH_MS)
    return result.code === 0
      ? { repo: repo.name, ok: true, message: `${current || '(detached)'} → ${branch}` }
      : { repo: repo.name, ok: false, message: firstLine(result.stderr) || '切换失败' }
  }
  const remote = await firstRemote(repo)
  if (remote !== null) {
    const remoteRef = await git(repo.path, ['show-ref', '--verify', '--quiet', `refs/remotes/${remote}/${branch}`], TIMEOUT_SWITCH_MS)
    if (remoteRef.code === 0) {
      const result = await git(repo.path, ['switch', '--track', `${remote}/${branch}`], TIMEOUT_SWITCH_MS)
      return result.code === 0
        ? { repo: repo.name, ok: true, message: `${current || '(detached)'} → ${branch}（跟踪 ${remote}/${branch}）` }
        : { repo: repo.name, ok: false, message: firstLine(result.stderr) || '切换失败' }
    }
  }
  if (create) {
    const result = await git(repo.path, ['switch', '-c', branch], TIMEOUT_SWITCH_MS)
    return result.code === 0
      ? { repo: repo.name, ok: true, message: `${current || '(detached)'} → ${branch}（新建）` }
      : { repo: repo.name, ok: false, message: firstLine(result.stderr) || '新建分支失败' }
  }
  return { repo: repo.name, ok: false, skipped: true, message: `分支 ${branch} 不存在（本地与远端均未找到）` }
}

/** ahead/behind commit counts relative to upstream (HEAD...@{u}); null when unavailable. */
async function divergenceCount(repo) {
  const result = await git(repo.path, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'], TIMEOUT_STATUS_MS)
  if (result.code !== 0) return null
  // Output is "<ahead> <behind>": left = HEAD-only commits, right = upstream-only.
  const parts = result.stdout.trim().split(/\s+/)
  if (parts.length < 2) return null
  return {
    ahead: parseInt(parts[0], 10) || 0,
    behind: parseInt(parts[1], 10) || 0,
  }
}

/**
 * Pull one repo. Default is fast-forward only (safe); when `rebase` is set, a
 * diverged branch is instead rebased onto its upstream (IDEA-style update).
 * On a fast-forward failure due to divergence the message reports ahead/behind
 * counts and points the user at the rebase mode.
 */
async function pullRepo(repo, options = {}) {
  const rebase = options.rebase === true
  const upstream = await git(repo.path, ['rev-parse', '--verify', '--quiet', '@{u}'], TIMEOUT_STATUS_MS)
  if (upstream.code !== 0) {
    return { repo: repo.name, ok: false, skipped: true, message: '当前分支没有上游分支，无法更新' }
  }
  if (rebase) {
    const result = await git(repo.path, ['pull', '--rebase'], TIMEOUT_PULL_MS)
    if (result.code !== 0) {
      const stderr = result.stderr || ''
      if (stderr.includes('CONFLICT')) {
        return { repo: repo.name, ok: false, message: '变基冲突，需手动解决：git rebase --continue / --abort（本面板的后续操作可能被阻塞）' }
      }
      const dirtyHint = stderr.includes('local changes') || stderr.includes('cannot rebase')
        ? '（本地有未提交修改，变基前需先提交或暂存）'
        : ''
      return { repo: repo.name, ok: false, message: `${firstLine(stderr) || '变基更新失败'}${dirtyHint}` }
    }
    const summary = firstLine(result.stdout) || '已变基到最新'
    return { repo: repo.name, ok: true, message: summary }
  }
  const result = await git(repo.path, ['pull', '--ff-only'], TIMEOUT_PULL_MS)
  if (result.code !== 0) {
    const stderr = result.stderr || ''
    const message = firstLine(stderr) || '更新失败'
    const dirtyHint = stderr.includes('local changes') ? '（本地有未提交修改）' : ''
    let divHint = ''
    if (stderr.includes('cannot be fast-forwarded') || stderr.includes('Diverging branches')) {
      const counts = await divergenceCount(repo)
      divHint = counts === null
        ? '（分支已分叉，无法快进；可改用“变基更新”或先推送本地提交）'
        : `（本地领先 ${counts.ahead} 个提交 / 落后远端 ${counts.behind} 个提交，无法快进；可改用“变基更新”或先推送本地提交）`
    }
    return { repo: repo.name, ok: false, message: `${message}${dirtyHint}${divHint}` }
  }
  const summary = firstLine(result.stdout) || 'Already up to date.'
  return { repo: repo.name, ok: true, message: summary }
}

/** Fetch one repo. */
async function fetchRepo(repo) {
  const remote = await firstRemote(repo)
  if (remote === null) {
    return { repo: repo.name, ok: false, skipped: true, message: '没有配置远端' }
  }
  const result = await git(repo.path, ['fetch', '--prune', remote], TIMEOUT_PULL_MS)
  return result.code === 0
    ? { repo: repo.name, ok: true, message: `已同步 ${remote}` }
    : { repo: repo.name, ok: false, message: firstLine(result.stderr) || 'fetch 失败' }
}

/** The repo's current branch name, or null when detached. */
async function currentBranch(repo) {
  const result = await git(repo.path, ['branch', '--show-current'], TIMEOUT_STATUS_MS)
  if (result.code !== 0) return null
  const branch = firstLine(result.stdout)
  return branch === '' ? null : branch
}

/** Whether the branch has an upstream configured. */
async function hasUpstream(repo) {
  const result = await git(repo.path, ['rev-parse', '--verify', '--quiet', '@{u}'], TIMEOUT_STATUS_MS)
  return result.code === 0
}

/** Push one repo's current branch. */
async function pushRepo(repo, options) {
  const { setUpstream = false } = options
  const branch = await currentBranch(repo)
  if (branch === null) {
    return { repo: repo.name, ok: false, skipped: true, message: '当前处于 detached HEAD，无法推送' }
  }
  const remote = await firstRemote(repo)
  if (remote === null) {
    return { repo: repo.name, ok: false, skipped: true, message: '没有配置远端，无法推送' }
  }
  const tracked = await hasUpstream(repo)
  if (!tracked && !setUpstream) {
    return { repo: repo.name, ok: false, skipped: true, message: '当前分支没有上游，勾选“设置上游并推送”' }
  }
  const args = tracked
    ? ['push', remote]
    : ['push', '-u', remote, branch]
  const result = await git(repo.path, args, TIMEOUT_PUSH_MS)
  if (result.code !== 0) {
    const message = firstLine(result.stderr) || '推送失败'
    const hint = result.stderr.includes('non-fast-forward') || result.stderr.includes('fetch first')
      ? '（远端领先，需要先更新代码）'
      : result.stderr.includes('Permission denied') || result.stderr.includes('Authentication failed')
        ? '（认证失败，请检查用户名/密码或凭证）'
        : ''
    return { repo: repo.name, ok: false, message: `${message}${hint}` }
  }
  const summary = firstLine(result.stdout) || `已推送 ${branch} → ${remote}`
  return { repo: repo.name, ok: true, message: summary }
}

/** Commit staged + (optionally) all changes in one repo. */
async function commitRepo(repo, message, addAll) {
  if (addAll) {
    const add = await git(repo.path, ['add', '-A'], TIMEOUT_SWITCH_MS)
    if (add.code !== 0) {
      return { repo: repo.name, ok: false, message: firstLine(add.stderr) || 'git add 失败' }
    }
    const staged = await git(repo.path, ['diff', '--cached', '--quiet'], TIMEOUT_STATUS_MS)
    if (staged.code === 0) {
      return { repo: repo.name, ok: false, skipped: true, message: '没有可提交的修改' }
    }
  } else {
    const staged = await git(repo.path, ['diff', '--cached', '--quiet'], TIMEOUT_STATUS_MS)
    if (staged.code === 0) {
      return { repo: repo.name, ok: false, skipped: true, message: '没有已暂存的修改（可选“包含全部修改”）' }
    }
  }
  const result = await git(repo.path, ['commit', '-m', message], TIMEOUT_SWITCH_MS)
  if (result.code !== 0) {
    const stderr = result.stderr || ''
    if (stderr.includes('nothing to commit')) {
      return { repo: repo.name, ok: false, skipped: true, message: '没有可提交的修改' }
    }
    return { repo: repo.name, ok: false, message: firstLine(stderr) || '提交失败' }
  }
  return { repo: repo.name, ok: true, message: firstLine(result.stdout) || '已提交' }
}

/**
 * Clone a repo into the workspace root. The target directory is validated
 * against a conservative name pattern and must not already exist, so a
 * malformed URL can never escape the workspace.
 */
async function cloneRepo(wsPath, url, dir, branch) {
  const target = join(wsPath, dir)
  if (existsSync(target)) {
    return { ok: false, message: `目录 ${dir} 已存在` }
  }
  const args = branch === null
    ? ['clone', '--', url, dir]
    : ['clone', '--branch', branch, '--', url, dir]
  const result = await git(wsPath, args, TIMEOUT_CLONE_MS)
  return result.code === 0
    ? { ok: true, message: `已克隆 ${dir}`, repo: dir }
    : { ok: false, message: firstLine(result.stderr) || '克隆失败' }
}

/** Whether the target dir for a clone stays inside the workspace root. */
function validateCloneDir(wsPath, dir) {
  if (typeof dir !== 'string' || dir === '') return null
  if (dir !== basename(dir) || dir === '.' || dir === '..') return null
  if (!/^[A-Za-z0-9._-]+$/.test(dir)) return null
  const target = resolve(wsPath, dir)
  const rel = relative(wsPath, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
  return dir
}

/** Validate a clone URL: must parse as a git remote-style URL. */
function validateCloneUrl(url) {
  if (typeof url !== 'string' || url === '') return null
  if (url.length > 4000) return null
  // Allow http(s)://host/path, git@host:path, ssh://host/path, or a local
  // absolute path so cloning from the same machine works.
  const httpMatch = /^[a-z][a-z0-9+.-]*:\/\//i
  const scpLike = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:/
  const localPath = /^\//
  if (!httpMatch.test(url) && !scpLike.test(url) && !localPath.test(url)) return null
  if (url.includes('\n') || url.includes('\r') || url.includes('\0')) return null
  return url
}

/** Infer a directory name from a clone URL (basename minus trailing .git). */
function dirFromUrl(url) {
  const cleaned = url.split(/[?#]/)[0].replace(/\/+$/, '')
  const seg = cleaned.split('/').pop() || ''
  const name = seg.replace(/\.git$/i, '')
  return name === '' ? null : name
}

/** Git config key name (section.name), blocking path/option injection. */
const CONFIG_KEY_RE = /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z][A-Za-z0-9-]*)+$/

function validateConfigKey(key) {
  if (typeof key !== 'string' || key === '') return null
  if (key.length > 200 || !CONFIG_KEY_RE.test(key)) return null
  return key
}

/** List config entries as seen by a repo (local + global merged, origin shown). */
async function readRepoConfig(repo) {
  const result = await git(
    repo.path,
    ['config', '--list', '--show-origin'],
    TIMEOUT_STATUS_MS,
  )
  if (result.code !== 0) return []
  const entries = []
  // Each line is "<origin>\t<key>=<value>"; origin is often file:/path or file:.git/config.
  for (const line of result.stdout.split('\n')) {
    if (line === '') continue
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const origin = line.slice(0, tab).replace(/^file:/, '')
    const kv = line.slice(tab + 1)
    const eq = kv.indexOf('=')
    if (eq === -1) continue
    const key = kv.slice(0, eq)
    const value = kv.slice(eq + 1)
    entries.push({ key, value: value.slice(0, 500), origin: origin.slice(-200) })
  }
  return entries
}

/** Read a JSON request body (with a size ceiling). */
function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1_048_576) {
        rejectBody(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolveBody({})
        return
      }
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        rejectBody(error)
      }
    })
    req.on('error', rejectBody)
  })
}

/** Validate the workspace path from a request body. */
function resolveWorkspace(body) {
  const ws = typeof body?.ws === 'string' ? body.ws.trim() : ''
  if (ws === '' || !ws.startsWith('/')) return undefined
  const resolved = resolve(ws)
  if (!existsSync(resolved)) return undefined
  return resolved
}

/** Validate a branch name from a request body. */
function resolveBranch(body) {
  const branch = typeof body?.branch === 'string' ? body.branch.trim() : ''
  if (branch === '' || branch.length > 200 || !BRANCH_RE.test(branch) || branch.includes('..')) return undefined
  return branch
}

/** Normalize the repo selection from a request body. */
const resolveSelection = (body) => {
  const repos = body?.repos
  if (repos === 'all' || repos === undefined || repos === null) return 'all'
  if (Array.isArray(repos)) return repos.filter(item => typeof item === 'string')
  return 'all'
}

/**
 * Persist a username/password into git's credential store for a host.
 * The credential helper must already be configured (e.g.
 * `git config --global credential.helper store`); approval writes the
 * credential to that helper (store → ~/.git-credentials).
 * Returns { ok, message }.
 */
function approveCredential(host, username, password) {
  return new Promise((resolveResult) => {
    const input = `protocol=https\nhost=${host}\nusername=${username}\npassword=${password}\n`
    const child = spawn('git', ['credential', 'approve'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: TIMEOUT_STATUS_MS,
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 4000) stderr = stderr.slice(-4000)
    })
    child.on('error', (error) => {
      resolveResult({ ok: false, message: error.message || '无法启动 git' })
    })
    child.on('close', (code) => {
      if (code === 0) resolveResult({ ok: true, message: `凭证已保存到 ${host}（依赖已配置的 credential helper）` })
      else resolveResult({ ok: false, message: firstLine(stderr) || `git credential 退出码 ${code}` })
    })
    child.stdin.end(input)
  })
}

/** Parse and validate a credential request: {host, username, password}. */
function resolveCredential(body) {
  const host = typeof body?.host === 'string' ? body.host.trim() : ''
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (host === '' || host.length > 253 || host.includes('/') || host.includes(' ') || host.includes('\n')) return null
  if (username === '' || username.length > 200) return null
  if (password === '' || password.length > 2000) return null
  return { host, username, password }
}

/** Send one JSON response. */
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

/* ======================================================================== *
 * Workspace-scoped credentials (.env of the workspace directory)          *
 * ======================================================================== */

/** Keys this plugin manages inside <workspace>/.env. */
const WORKSPACE_ENV_KEYS = ['GITLAB_INSTANCE_URL', 'GITLAB_USERNAME', 'GITLAB_TOKEN']
const INSTANCE_URL_KEY = WORKSPACE_ENV_KEYS[0]
const USERNAME_KEY = WORKSPACE_ENV_KEYS[1]
const TOKEN_KEY = WORKSPACE_ENV_KEYS[2]

/**
 * Starter keys shown in the 配置 tab .env editor when <ws>/.env is missing
 * or empty — covers both HTTP GitLab workspaces (URL/user/token) and SSH
 * workspaces (remote URL / key path). Values are left blank for the user.
 */
const DEFAULT_ENV_KEYS = [
  'GITLAB_INSTANCE_URL',
  'GITLAB_USERNAME',
  'GITLAB_TOKEN',
  'GIT_REMOTE_URL',
  'GIT_SSH_KEY_PATH',
]

/** Extract a bare hostname from a git remote URL (http(s), ssh, scp-like). Returns null when none. */
function parseHostFromUrl(url) {
  if (typeof url !== 'string') return null
  const trimmed = url.trim()
  if (trimmed === '') return null
  let rest = trimmed
  // scheme://[user@]host[:port]/path
  const schemeMatch = trimmed.match(/^[a-z][a-z0-9+.-]*:\/\/([^/]+)/i)
  if (schemeMatch) {
    rest = schemeMatch[1]
  } else {
    // scp-like: [user@]host:path (no scheme)
    const scpMatch = trimmed.match(/^(?:[^@/]+@)?([^:/]+):/)
    if (scpMatch) return scpMatch[1]
    return null
  }
  rest = rest.replace(/^[^@/]*@/, '') // strip user@
  const host = rest.split(':')[0].split('/')[0]
  if (host === '') return null
  return host
}

/** Read the workspace .env file into { path, exists, values } (values has no secrets beyond what's in the file). */
function readWorkspaceEnv(wsPath) {
  const envPath = join(wsPath, '.env')
  const values = {}
  if (existsSync(envPath)) {
    try {
      const text = readFileSync(envPath, 'utf8')
      for (const line of text.split('\n')) {
        const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
        if (match) values[match[1]] = match[2]
      }
    } catch {
      // unreadable env — treat as absent
    }
  }
  return { path: envPath, exists: existsSync(envPath), values }
}

/** Compute the credentials view for a workspace: what the UI should show for host/username/token. */
function workspaceCredentialView(wsPath) {
  const env = readWorkspaceEnv(wsPath)
  const instanceUrl = env.values[INSTANCE_URL_KEY] ?? ''
  const username = env.values[USERNAME_KEY] ?? ''
  const token = env.values[TOKEN_KEY] ?? ''
  // Derive a bare host from the instance URL (strip protocol + path).
  let host = parseHostFromUrl(instanceUrl)
  if (host === null && instanceUrl !== '') host = instanceUrl.trim().replace(/\/+$/, '')
  return {
    envPath: env.path,
    envExists: env.exists,
    host: host ?? '',
    username,
    hasToken: token !== '',
    tokenLength: token.length,
  }
}

/** Read the workspace .env into an ordered entry list (comments/blank lines not preserved). */
function readEnvEntries(wsPath) {
  const envPath = join(wsPath, '.env')
  const entries = []
  if (existsSync(envPath)) {
    try {
      const text = readFileSync(envPath, 'utf8')
      for (const line of text.split('\n')) {
        const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
        if (match) entries.push({ key: match[1], value: match[2] })
      }
    } catch {
      // unreadable env — treat as empty
    }
  }
  return { path: envPath, exists: existsSync(envPath), entries }
}

/**
 * Generic .env writer: rewrite the file line by line, replacing values for
 * keys present in `entries` (appending missing ones at the end), dropping
 * keys listed in `removeKeys`, and leaving every other line (comments,
 * unrelated vars) untouched.
 */
function writeEnvEntries(wsPath, entries, options = {}) {
  const { removeKeys = [] } = options
  const envPath = join(wsPath, '.env')
  const updates = {}
  for (const entry of entries) {
    if (entry && typeof entry.key === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.key)) {
      updates[entry.key] = typeof entry.value === 'string' ? entry.value : ''
    }
  }
  const removeSet = new Set(removeKeys)
  let out = ''
  let seen = new Set()
  if (existsSync(envPath)) {
    try {
      const text = readFileSync(envPath, 'utf8')
      for (const line of text.split('\n')) {
        const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
        if (match && removeSet.has(match[1])) {
          // dropped
        } else if (match && Object.prototype.hasOwnProperty.call(updates, match[1])) {
          out += `${match[1]}=${updates[match[1]]}\n`
          seen.add(match[1])
        } else {
          out += `${line}\n`
        }
      }
    } catch {
      // fall through to fresh write
    }
  }
  for (const key of Object.keys(updates)) {
    if (!seen.has(key) && !removeSet.has(key)) out += `${key}=${updates[key]}\n`
  }
  writeFileSync(envPath, out, 'utf8')
  return { envPath, updated: Object.keys(updates), removed: Array.from(removeSet) }
}

/**
 * Persist {host, username, token?} into <workspace>/.env, preserving every
 * other line (the file may carry unrelated vars). Lines are rewritten
 * in place; missing keys are appended. A null/empty token leaves the
 * existing token untouched. `removeKeys` deletes keys (and wins over
 * updates for the same key).
 */
function writeWorkspaceEnv(wsPath, host, username, token, options = {}) {
  const envPath = join(wsPath, '.env')
  const oldValues = {}
  if (existsSync(envPath)) {
    try {
      const text = readFileSync(envPath, 'utf8')
      for (const line of text.split('\n')) {
        const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
        if (match) oldValues[match[1]] = match[2]
      }
    } catch {
      // ignore read errors below
    }
  }
  // Normalize the instance URL so the helper's host comparison keeps working:
  // git sends "host=<bare-host>", the script strips scheme from GITLAB_INSTANCE_URL.
  const scheme = oldValues[INSTANCE_URL_KEY] && /^https?:\/\//i.test(oldValues[INSTANCE_URL_KEY])
    ? oldValues[INSTANCE_URL_KEY].match(/^(https?:\/\/)/i)[1]
    : 'https://'
  const cleanHost = host.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  const entries = [
    { key: INSTANCE_URL_KEY, value: `${scheme}${cleanHost}` },
    { key: USERNAME_KEY, value: username },
  ]
  const newToken = typeof token === 'string' && token.trim() !== '' ? token : null
  if (newToken !== null) entries.push({ key: TOKEN_KEY, value: newToken })
  return writeEnvEntries(wsPath, entries, options)
}

/** Detect the distinct remote hosts across the workspace repos (for display/prefill). */
async function workspaceRemoteHosts(wsPath, repos) {
  const hosts = new Set()
  await mapPool(repos, CONCURRENCY, async (repo) => {
    const result = await git(repo.path, ['config', '--get', 'remote.origin.url'], TIMEOUT_STATUS_MS)
    if (result.code !== 0) return
    const host = parseHostFromUrl(firstLine(result.stdout))
    if (host !== null) hosts.add(host)
  })
  return Array.from(hosts).sort()
}

/* ======================================================================== *
 * Global credentials (shared across every workspace) in ~/.dsh/...         *
 * ======================================================================== */

/** Plugin-managed data dir inside DSH_HOME (never inside a workspace repo). */
function pluginDataDir() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'dsh-git-branch')
}

/** Absolute path of the global credential file (Env format: KEY=VALUE). */
function globalCredentialFile() {
  return join(pluginDataDir(), 'credential.env')
}

/** Read the global credential file → { path, exists, username, hasToken, tokenLength }. */
function readGlobalCredential() {
  const file = globalCredentialFile()
  const values = {}
  if (existsSync(file)) {
    try {
      const text = readFileSync(file, 'utf8')
      for (const line of text.split('\n')) {
        const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
        if (match) values[match[1]] = match[2]
      }
    } catch {
      // unreadable → treat as absent
    }
  }
  const username = values[USERNAME_KEY] ?? ''
  const token = values[TOKEN_KEY] ?? ''
  return {
    path: file,
    exists: existsSync(file),
    username,
    hasToken: token !== '',
    tokenLength: token.length,
  }
}

/**
 * Persist the globally shared username/token. The file holds only the two
 * plugin-managed keys; a non-empty `token` replaces the stored one, an empty
 * `token` keeps the existing token (x the deleted token line) so the UI can
 * leave the token blank to keep the current one.
 */
function writeGlobalCredential(username, token) {
  const file = globalCredentialFile()
  const values = {}
  if (existsSync(file)) {
    try {
      const text = readFileSync(file, 'utf8')
      for (const line of text.split('\n')) {
        const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
        if (match) values[match[1]] = match[2]
      }
    } catch {
      // unreadable → rewrite from scratch
    }
  }
  if (username !== '') values[USERNAME_KEY] = username
  const newToken = typeof token === 'string' && token.trim() !== '' ? token : null
  if (newToken !== null) values[TOKEN_KEY] = newToken
  const dir = pluginDataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  let out = ''
  for (const key of [USERNAME_KEY, TOKEN_KEY]) {
    if (Object.prototype.hasOwnProperty.call(values, key)) out += `${key}=${values[key]}\n`
  }
  writeFileSync(file, out, 'utf8')
  return {
    path: file,
    username: values[USERNAME_KEY] ?? '',
    hasToken: Object.prototype.hasOwnProperty.call(values, TOKEN_KEY),
  }
}

/** Absolute path of the generated global credential helper script. */
function globalHelperFile() {
  return join(pluginDataDir(), 'git-credential.sh')
}

/**
 * Write the generated credential helper (mode 0700). It walks up from the
 * repo's working directory to find <workspace>/.env, reads the instance URL
 * to derive the host, and when it matches the host git is asking about it
 * prints the globally stored username/token. Everything else is ignored so
 * the helper is safe on unrelated hosts.
 */
function writeGlobalHelper() {
  const file = globalHelperFile()
  const dir = pluginDataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const script = [
    '#!/bin/bash',
    '# Generated by dsh-git-branch — global credential helper.',
    '# Looks up each workspace .env (GITLAB_INSTANCE_URL) for a host match,',
    '# then answers with the globally stored username/token.',
    'set -euo pipefail',
    '',
    'action="${1:-}"',
    'if [ "$action" != "get" ]; then exit 0; fi',
    '',
    'host=""',
    'while IFS="=" read -r key value; do',
    '  case "$key" in',
    '    host) host="$value" ;;',
    '  esac',
    'done',
    '',
    `CRED_FILE="${globalCredentialFile()}"`,
    'dir="${PWD}"',
    'while [ "$dir" != "/" ]; do',
    '  if [ -f "$dir/.env" ]; then',
    "    url=$(grep '^GITLAB_INSTANCE_URL=' \"$dir/.env\" 2>/dev/null | head -1 | cut -d= -f2- || true)",
    '    if [ -n "$url" ]; then',
    "      ih=$(printf '%s' \"$url\" | sed -E 's|https?://||' | sed -E 's|/.*$||')",
    '      if [ "$ih" = "$host" ]; then',
    "        username=$(grep '^GITLAB_USERNAME=' \"$CRED_FILE\" 2>/dev/null | head -1 | cut -d= -f2 || true)",
    "        token=$(grep '^GITLAB_TOKEN=' \"$CRED_FILE\" 2>/dev/null | head -1 | cut -d= -f2 || true)",
    '        if [ -n "$username" ] && [ -n "$token" ]; then',
    '          echo "username=$username"',
    '          echo "password=$token"',
    '          exit 0',
    '        fi',
    '      fi',
    '    fi',
    '  fi',
    '  dir=$(dirname "$dir")',
    'done',
    '',
    'exit 0',
    '',
  ].join('\n')
  writeFileSync(file, script, 'utf8')
  chmodSync(file, 0o700)
  return file
}

/** Register the generated helper in the global git config (idempotent). */
async function registerGlobalHelper() {
  const file = writeGlobalHelper()
  const existing = await git(homedir(), ['config', '--global', '--get-all', 'credential.helper'], TIMEOUT_STATUS_MS)
  const helpers = existing.code === 0 && existing.stdout.trim() !== ''
    ? existing.stdout.split('\n').map((s) => s.trim())
    : []
  if (!helpers.includes(file)) {
    await git(homedir(), ['config', '--global', '--add', 'credential.helper', file], TIMEOUT_SWITCH_MS)
  }
  return { helper: file, registered: true }
}

/**
 * Save credentials for one workspace AND the global defaults in one shot.
 *   - username + token               → global credential file (shared across all workspaces)
 *   - host                           → <workspace>/.env (GITLAB_INSTANCE_URL)
 *   - the workspace .env is scrubbed of any old GITLAB_USERNAME / GITLAB_TOKEN
 *     keys so the global file is the single source of truth for credentials
 *   - the generated helper is registered, so git resolves per-workspace host
 *     from .env and answers with the global username/token — the user's
 *     existing .git-credential scripts keep working untouched.
 */
async function saveCredentials(wsPath, host, username, token) {
  const globalResult = writeGlobalCredential(username, token)
  // Remove the legacy per-workspace credentials; keep everything else.
  const envResult = writeWorkspaceEnv(wsPath, host, '', '', {
    removeKeys: [USERNAME_KEY, TOKEN_KEY],
  })
  const helper = await registerGlobalHelper()
  return { global: globalResult.path, env: envResult.envPath, helper: helper.helper }
}

/**
 * The route handler: pure request → response over the workspace directory.
 * Kept separate from apply() so it is testable without a live context.
 */
async function handleRoute(req, res) {
  const url = req.url ?? '/'
  let route = url.split('?')[0]
  // The web server hands the handler the FULL path; strip our prefix.
  if (route.startsWith(ROUTE_PREFIX)) route = route.slice(ROUTE_PREFIX.length)
  if (route === '') route = '/'
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }
  let body
  try {
    body = await readBody(req)
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' })
    return
  }
  const wsPath = resolveWorkspace(body)
  if (wsPath === undefined) {
    sendJson(res, 400, { error: 'ws 必须是存在的绝对路径' })
    return
  }

  if (route === '/status') {
    const { repos } = selectRepos(wsPath, 'all')
    const rows = await mapPool(repos, CONCURRENCY, repo => repoStatus(repo))
    sendJson(res, 200, { ws: wsPath, repos: rows })
    return
  }

  if (route === '/branch-names') {
    const { repos, unknown } = selectRepos(wsPath, resolveSelection(body))
    const nameSets = await mapPool(repos, CONCURRENCY, repo => repoBranchNames(repo))
    const union = new Set()
    for (const names of nameSets) for (const branch of names) union.add(branch)
    const names = [...union].sort((a, b) => a.localeCompare(b))
    sendJson(res, 200, { ws: wsPath, names, unknown })
    return
  }

  if (route === '/switch') {
    const branch = resolveBranch(body)
    if (branch === undefined) {
      sendJson(res, 400, { error: 'branch 非法或缺失' })
      return
    }
    const { repos, unknown } = selectRepos(wsPath, resolveSelection(body))
    const options = {
      create: body?.create === true,
      allowDirty: body?.allowDirty === true,
    }
    const results = await mapPool(repos, CONCURRENCY, repo => switchRepo(repo, branch, options))
    for (const missing of unknown) results.push({ repo: missing, ok: false, skipped: true, message: '未在工作区中找到该仓库' })
    sendJson(res, 200, { ws: wsPath, branch, results })
    return
  }

  if (route === '/pull') {
    const { repos, unknown } = selectRepos(wsPath, resolveSelection(body))
    const options = { rebase: body?.rebase === true }
    const results = await mapPool(repos, CONCURRENCY, repo => pullRepo(repo, options))
    for (const missing of unknown) results.push({ repo: missing, ok: false, skipped: true, message: '未在工作区中找到该仓库' })
    sendJson(res, 200, { ws: wsPath, rebase: options.rebase, results })
    return
  }

  if (route === '/fetch') {
    const { repos, unknown } = selectRepos(wsPath, resolveSelection(body))
    const results = await mapPool(repos, CONCURRENCY, repo => fetchRepo(repo))
    for (const missing of unknown) results.push({ repo: missing, ok: false, skipped: true, message: '未在工作区中找到该仓库' })
    sendJson(res, 200, { ws: wsPath, results })
    return
  }

  if (route === '/clone') {
    const url = validateCloneUrl(body?.url)
    if (url === null) {
      sendJson(res, 400, { error: 'url 必须是有效的 git 地址（http(s)://、git@host:、ssh:// 或本地路径）' })
      return
    }
    let dir = typeof body?.dir === 'string' && body.dir.trim() !== '' ? body.dir.trim() : null
    if (dir === null) dir = dirFromUrl(url)
    if (dir === null || validateCloneDir(wsPath, dir) === null) {
      sendJson(res, 400, { error: '目录名非法：仅允许字母数字 . _ -，且不能越出工作区' })
      return
    }
    let branch = null
    if (body?.branch !== undefined) {
      branch = resolveBranch(body)
      if (branch === undefined) {
        sendJson(res, 400, { error: 'branch 非法' })
        return
      }
    }
    const result = await cloneRepo(wsPath, url, dir, branch)
    sendJson(res, result.ok ? 200 : 422, { ws: wsPath, url, dir, ...result })
    return
  }

  if (route === '/push') {
    const { repos, unknown } = selectRepos(wsPath, resolveSelection(body))
    const options = { setUpstream: body?.setUpstream === true }
    const results = await mapPool(repos, CONCURRENCY, repo => pushRepo(repo, options))
    for (const missing of unknown) results.push({ repo: missing, ok: false, skipped: true, message: '未在工作区中找到该仓库' })
    sendJson(res, 200, { ws: wsPath, results })
    return
  }

  if (route === '/commit') {
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    if (message === '' || message.length > 2000) {
      sendJson(res, 400, { error: 'message 必须是非空字符串（≤2000 字符）' })
      return
    }
    const { repos, unknown } = selectRepos(wsPath, resolveSelection(body))
    const results = await mapPool(repos, CONCURRENCY, repo => commitRepo(repo, message, body?.addAll === true))
    for (const missing of unknown) results.push({ repo: missing, ok: false, skipped: true, message: '未在工作区中找到该仓库' })
    sendJson(res, 200, { ws: wsPath, results })
    return
  }

  if (route === '/git-config') {
    const readRepo = ({ repos }) => repos[0]
    const action = body?.action ?? 'list' // list | get | set-kv | unset-kv | set-helper | credential
    if (action === 'credential') {
      const cred = resolveCredential(body)
      if (cred === null) {
        sendJson(res, 400, { error: 'host / username / password 必填且格式非法' })
        return
      }
      const result = await approveCredential(cred.host, cred.username, cred.password)
      sendJson(res, result.ok ? 200 : 422, { ws: wsPath, host: cred.host, ...result })
      return
    }

    if (action === 'ws-cred') {
      // Workspace-scoped credential view: read <ws>/.env + detected remote hosts.
      const { repos, unknown } = selectRepos(wsPath, resolveSelection(body))
      const view = workspaceCredentialView(wsPath)
      const hosts = await workspaceRemoteHosts(wsPath, repos)
      sendJson(res, 200, {
        ws: wsPath,
        envPath: view.envPath,
        envExists: view.envExists,
        host: view.host,
        username: view.username,
        hasToken: view.hasToken,
        tokenLength: view.tokenLength,
        remoteHosts: hosts,
        missingRepos: unknown,
      })
      return
    }

    if (action === 'read-ws-env') {
      // Full key/value view of <ws>/.env for the 配置 tab editor.
      // When the file is missing or has no keys, show a starter template
      // (common keys for HTTP GitLab and SSH workspaces), values blank.
      const env = readEnvEntries(wsPath)
      let entries = env.entries
      if (entries.length === 0) {
        entries = DEFAULT_ENV_KEYS.map((key) => ({ key, value: '' }))
      }
      sendJson(res, 200, {
        ws: wsPath,
        path: env.path,
        exists: env.exists,
        entries,
        template: env.entries.length === 0,
      })
      return
    }

    if (action === 'save-ws-env') {
      // Persist the edited key/value list back to <ws>/.env line by line,
      // preserving comments and unrelated vars in the file.
      const entries = Array.isArray(body?.entries) ? body.entries : []
      if (entries.length > 200) {
        sendJson(res, 400, { error: 'entries 过多（最多 200 个键）' })
        return
      }
      for (const entry of entries) {
        if (!entry || typeof entry.key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.key) || entry.key.length > 128) {
          sendJson(res, 400, { error: `键名非法：${entry?.key ?? '(null)'}` })
          return
        }
        if (typeof entry.value !== 'string' || entry.value.length > 8000 || entry.value.includes('\n') || entry.value.includes('\r') || entry.value.includes('\0')) {
          sendJson(res, 400, { error: `值非法：${entry.key}` })
          return
        }
      }
      const removeKeys = Array.isArray(body?.removeKeys)
        ? body.removeKeys.filter((k) => typeof k === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k))
        : []
      const result = writeEnvEntries(wsPath, entries, { removeKeys })
      sendJson(res, 200, {
        ws: wsPath,
        ok: true,
        envPath: result.envPath,
        updated: result.updated,
        removed: result.removed,
        message: `已保存 ${result.envPath}（更新 ${result.updated.length} 个键${result.removed.length > 0 ? '，移除 ' + result.removed.length + ' 个键' : ''}）`,
      })
      return
    }

    if (action === 'global-cred') {
      // Globally shared username/token (one entry for every workspace).
      const global = readGlobalCredential()
      sendJson(res, 200, {
        file: global.path,
        exists: global.exists,
        username: global.username,
        hasToken: global.hasToken,
        tokenLength: global.tokenLength,
      })
      return
    }

    if (action === 'save-ws-cred') {
      const host = typeof body?.host === 'string' ? body.host.trim() : ''
      const username = typeof body?.username === 'string' ? body.username.trim() : ''
      const token = typeof body?.token === 'string' ? body.token : ''
      if (host === '' || host.length > 253 || host.includes(' ') || host.includes('/') || host.includes('\n') || host.includes('\r') || host.includes('\0')) {
        sendJson(res, 400, { error: 'host 非法' })
        return
      }
      if (username === '' || username.length > 200 || username.includes('\n') || username.includes('\0')) {
        sendJson(res, 400, { error: 'username 非法' })
        return
      }
      if (token.length > 4000 || token.includes('\n') || token.includes('\r') || token.includes('\0')) {
        sendJson(res, 400, { error: 'token 非法' })
        return
      }
      // Shared username/token → global defaults; host → workspace .env; the
      // legacy per-workspace credential keys are scrubbed and the generated
      // helper is registered so git resolves host from .env + global creds.
      const saved = await saveCredentials(wsPath, host, username, token)
      sendJson(res, 200, {
        ws: wsPath,
        ok: true,
        globalFile: saved.global,
        envPath: saved.env,
        helper: saved.helper,
        message: `已保存：账号密码 → ${saved.global}，host → ${saved.env}（helper: ${saved.helper}）`,
      })
      return
    }

    if (action === 'clear-ws-cred') {
      // Remove the plugin-managed keys from <ws>/.env.
      const result = writeWorkspaceEnv(wsPath, '', '', '', { removeKeys: WORKSPACE_ENV_KEYS })
      sendJson(res, 200, {
        ws: wsPath,
        envPath: result.envPath,
        ok: true,
        removed: result.removed,
        message: `已清除 ${result.envPath} 中的 git 凭证配置`,
      })
      return
    }

    const { repos, unknown } = selectRepos(wsPath, resolveSelection(body))
    if (repos.length === 0) {
      sendJson(res, 400, { error: '工作区中没有可读取 git 配置的仓库' })
      return
    }

    if (action === 'list') {
      const entries = await readRepoConfig(repos[0])
      sendJson(res, 200, { ws: wsPath, repo: repos[0].name, entries })
      return
    }

    if (action === 'get') {
      const key = validateConfigKey(body?.key)
      if (key === null) {
        sendJson(res, 400, { error: 'key 非法（应为 section.name）' })
        return
      }
      // --get-all across scopes: the repo's effective value for that key.
      const result = await git(repos[0].path, ['config', '--get-all', key], TIMEOUT_STATUS_MS)
      const value = result.code === 0 ? firstLine(result.stdout) : null
      sendJson(res, 200, { ws: wsPath, repo: repos[0].name, key, value })
      return
    }

    if (action === 'set-kv' || action === 'unset-kv') {
      const key = validateConfigKey(body?.key)
      const scope = body?.scope === 'global' ? 'global' : 'local'
      if (key === null) {
        sendJson(res, 400, { error: 'key 非法（应为 section.name）' })
        return
      }
      if (action === 'unset-kv') {
        const results = await mapPool(repos, CONCURRENCY, async (repo) => {
          const args = scope === 'global'
            ? ['config', '--global', '--unset-all', key]
            : ['config', '--local', '--unset-all', key]
          const result = await git(repo.path, args, TIMEOUT_SWITCH_MS)
          return { repo: repo.name, ok: result.code === 0, skipped: result.code !== 0, message: result.code === 0 ? '已删除' : firstLine(result.stderr) || '删除失败' }
        })
        sendJson(res, 200, { ws: wsPath, scope, key, results })
        return
      }
      const value = typeof body?.value === 'string' ? body.value : ''
      if (value.length > 2000 || value.includes('\n') || value.includes('\r') || value.includes('\0')) {
        sendJson(res, 400, { error: 'value 非法' })
        return
      }
      const results = await mapPool(repos, CONCURRENCY, async (repo) => {
        const args = scope === 'global'
          ? ['config', '--global', key, value]
          : ['config', '--local', key, value]
        const result = await git(repo.path, args, TIMEOUT_SWITCH_MS)
        return { repo: repo.name, ok: result.code === 0, message: result.code === 0 ? '已保存' : firstLine(result.stderr) || '保存失败' }
      })
      sendJson(res, 200, { ws: wsPath, scope, key, results })
      return
    }

    sendJson(res, 400, { error: `unknown git-config action ${action}` })
    return
  }

  sendJson(res, 404, { error: `unknown route ${route}` })
}

/**
 * Plugin body: mount the route on the shared DSH web server.
 * @param ctx - host cordis context.
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        try {
          await handleRoute(req, res)
        } catch (error) {
          try {
            sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
          } catch {
            // response already settled — nothing left to report
          }
        }
      },
    }),
    'dsh-git-branch: routes',
  )
}
