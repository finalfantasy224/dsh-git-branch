# dsh-git-branch

A DeepSeek Harness plugin that brings IntelliJ IDEA-style git operations into the DSH web session: switch branches, update code, push, commit, clone, and manage git identity/credentials across all repositories in a workspace — or just selected ones. The panel is a fixed sidebar hugging the left edge of the conversation column.

## Features

- **Scan** all git repositories under your workspace directory (root + depth-1 children)
- **Switch branches** uniformly across repos: local branches, remote tracking creation, or new branch creation
- **Update code** (`git pull --ff-only`) with upstream awareness
- **Fetch & prune** remote references to keep ahead/behind counts accurate
- **Push** selected repos' current branch (optional `-u` to set upstream)
- **Commit** staged changes (optional `add -A` to include everything)
- **Clone** a repository into the workspace (URL → dir, optional branch)
- **Git identity**: read/set `user.name` / `user.email` at global or repo scope
- **Credentials**: persist username/password into the configured credential helper (`git credential approve`)
- **Per-repo selection**: select individual repos or operate on all at once
- **Dirty protection**: refuses to switch repos with uncommitted changes (toggleable)
- **Branch datalist**: auto-populated union of local + remote branches across selected repos
- **Result log**: timestamped per-repo status messages visible inline

## Installation

### Method A: Using pre-built npm package (recommended)

```bash
# Add to your DSH home profile (example: web profile)
cd $DSH_HOME/profiles/web
pnpm add <package-name>@latest
# Or manually install:
cp -r /path/to/dsh-git-branch ./local/dsh-git-branch
echo '"dsh-git-branch": "file:local/dsh-git-branch"' | cat > /tmp/deps.json && pnpm add file:local/dsh-git-branch
```

Then add the following to `$DSH_HOME/profiles/web/cordis.patch.yml`:
```yaml
- insert:
    - id: git-branch
      name: 'dsh-git-branch'
```

Restart `dsh web` to activate.

### Method B: Development install

```bash
# From the profile directory
cd $DSH_HOME/profiles/web
pnpm install   # reads dependencies from package.json including file: links
# Restart dsh web
```

## Architecture

### Host half (`lib/index.js`)

Registers HTTP prefix route on the DSH web server:

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/dsh-git-branch/status` | POST | `{ws}` | Scan all repos, return branch/dirty/ahead-behind stats |
| `/dsh-git-branch/branch-names` | POST | `{ws, repos}` | Union of local+remote branch names across selected repos |
| `/dsh-git-branch/switch` | POST | `{ws, repos, branch, create?, allowDirty?}` | Switch repos to target branch |
| `/dsh-git-branch/pull` | POST | `{ws, repos}` | Fast-forward pull on selected repos |
| `/dsh-git-branch/fetch` | POST | `{ws, repos}` | Fetch & prune all selected repos |
| `/dsh-git-branch/push` | POST | `{ws, repos, setUpstream?}` | Push current branch; `-u` when setUpstream |
| `/dsh-git-branch/commit` | POST | `{ws, repos, message, addAll?}` | Commit; `add -A` when addAll |
| `/dsh-git-branch/clone` | POST | `{ws, url, dir?, branch?}` | Clone into workspace (dir derived from url when omitted) |
| `/dsh-git-branch/git-config` | POST | see below | Identity + credential management |

`/git-config` actions:

| Action | Extra body | Description |
|--------|------------|-------------|
| `list` | — | Effective config of the first repo (with origin paths) |
| `get` | `{key}` | Effective value of one key (e.g. `user.name`) |
| `set-kv` | `{key, value, scope: 'global'\|'local'}` | Set key in every selected repo |
| `unset-kv` | `{key, scope}` | Unset key in every selected repo |
| `ws-cred` | — | Workspace credential view: host from `<ws>/.env`, plus detected remote hosts |
| `global-cred` | — | Globally shared username/token view (`$DSH_HOME/dsh-git-branch/credential.env`) |
| `save-ws-cred` | `{host, username, token?}` | Save host → `<ws>/.env`; username/token → global credential file (blank token keeps the existing one); also registers the generated global helper |
| `clear-ws-cred` | — | Remove the plugin-managed keys from `<ws>/.env` only (global file untouched) |
| `read-ws-env` | — | Full key/value list of `<ws>/.env` for the 配置 tab editor |
| `save-ws-env` | `{entries, removeKeys?}` | Write the edited key/value list back to `<ws>/.env` line by line (comments and unrelated vars preserved; keys in `removeKeys` are dropped) |
| `credential` | `{host, username, password}` | `git credential approve` into the configured helper |

### Credential model

Two-part layout — **username + token are global, host is per-workspace**:

- `<workspace>/.env` holds only the host: `GITLAB_INSTANCE_URL` (per workspace:
  `sm` → one GitLab host, `saas` → another).
- `$DSH_HOME/dsh-git-branch/credential.env` holds `GITLAB_USERNAME` /
  `GITLAB_TOKEN` once, shared by every workspace — configure them in the
  plugin's 配置 tab, not per workspace.
- On save the plugin also registers a generated global credential helper
  (`$DSH_HOME/dsh-git-branch/git-credential.sh` as `credential.helper`). On a
  `get` the helper walks up from the repo's working directory to find the
  nearest `<workspace>/.env`, derives the host from `GITLAB_INSTANCE_URL`,
  and when it matches the host git asks about it answers with the global
  username/token. Unrelated hosts are ignored, so the helper is safe anywhere.
- Saving via the plugin also scrubs legacy `GITLAB_USERNAME` / `GITLAB_TOKEN`
  keys from `.env` so the global file is the single source of truth; any
  pre-existing per-workspace `.git-credential` scripts keep working untouched.

All endpoints accept `repos: string[] | 'all'` for repo selection. Path safety enforced via `resolve()` + directory scanning (user cannot inject arbitrary paths); clone target dirs must match `[A-Za-z0-9._-]+` and stay inside the workspace.

### Client half (`lib/client.js`)

Registers a UI entry into the `conversation.input.dock` slot (session-scoped), which renders as a **fixed sidebar hugging the left edge of the conversation column** (not a dock bar above the composer):

- Measures the conversation scrollport + composer seat, positioning the rail with inline styles in the blank lane left of the message column (collapses to a slim tab when the lane is too narrow)
- Four tabs: **分支** (switch branch, repo table), **同步** (pull / fetch / push / commit), **克隆** (clone form), **配置** (identity + global credentials + per-workspace `.env` key/value editor)
- Branch datalist, per-repo checkboxes, and a timestamped result log shared across tabs

Uses `--dsw-alias-*` CSS variables for theme compatibility with dark/light modes.

## Usage in Session

1. Open your DSH web session
2. The "Git 分支" sidebar appears on the left of the message column (collapsed tab when narrow)
3. **分支 tab**: choose target branch → select repos → 切换 / 切换并更新
4. **同步 tab**: 更新代码 (pull) / 同步远端 (fetch) / 推送 (push, optional 设上游) / 提交 (commit with message)
5. **克隆 tab**: paste repo URL (optionally dir + branch) → 克隆到工作区
6. **配置 tab**: pick 全局/仓库级 scope → set user.name / user.email → 保存身份配置; fill host/user/password (configure `credential.helper` first) → 保存凭证
7. Watch real-time results in the log at the bottom of the rail

## Dev Notes

- Built as a hand-authored plain-JS bundle (no build step) following the out-of-tree DSH plugin pattern
- Client uses `window.__ModuleLoader__.load()` contract; React arrived via factory `require`
- CSS injected once via `<style data-plugin-css="dsh-git-branch/style.css">`
- Host uses `child_process.execFile('git', ...)` with concurrency pool (4 workers) and timeouts; credentials use `spawn('git', ['credential', 'approve'])`
- Tested host endpoints against a scratch sandbox (clone/push/commit/config/credential + safety rejections) and the client against jsdom (rail geometry, tab rendering, narrow collapse)
- Host half changes require **restarting `dsh web`** (ES-module cache); client half hot-reloads via the plugin HMR chain

## License

MIT