/**
 * dsh-git-branch client half — a fixed sidebar hugging the left edge of the
 * conversation column that switches branches and pulls code across every git
 * repository in the current workspace (all at once, or a selected subset).
 *
 * The panel measures the conversation scrollport (via
 * [data-conversation-scroll]) and the composer seat, then positions itself by
 * inline style inside the blank lane left of the message column, filling that
 * lane top-to-bottom. When the lane is too narrow the rail collapses to a
 * slim tab button that expands the full panel on click.
 *
 * Hand-authored plain-JS bundle (no build step): a side-effect script that
 * registers through window.__ModuleLoader__.load, exactly like other
 * out-of-tree DSH client plugins. React arrives through the factory require.
 */
(function () {
  'use strict';

  /* ====================================================================== *
   * CSS — injected once, themed through the --dsw-alias-* semantic tokens  *
   * ====================================================================== */

  var CSS_TAG = 'dsh-git-branch/style.css';

  var CSS = [
    /* ---- rail (expanded sidebar) ---- */
    '.dshgb-rail {',
    '  position: fixed;',
    '  z-index: 40;',
    '  display: flex;',
    '  flex-direction: column;',
    '  border-radius: 12px;',
    '  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18));',
    '  background: var(--dsw-alias-bg-layer-1, color-mix(in srgb, var(--dsw-alias-bg-base) 88%, transparent));',
    '  box-shadow: 0 8px 24px rgba(0,0,0,.12);',
    '  font-size: 12px;',
    '  line-height: 1.5;',
    '  color: var(--dsw-alias-label-secondary, #8a919f);',
    '  overflow: hidden;',
    '}',
    '.dshgb-rail-head {',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 6px;',
    '  padding: 7px 8px 7px 10px;',
    '  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.12));',
    '  flex: none;',
    '}',
    '.dshgb-rail-icon { display: inline-flex; color: var(--dsw-alias-brand-primary, #4d6bfe); flex: none; }',
    '.dshgb-rail-title { font-weight: 600; color: var(--dsw-alias-label-primary, #e6e8ee); white-space: nowrap; }',
    '.dshgb-rail-ws {',
    '  min-width: 0;',
    '  overflow: hidden;',
    '  text-overflow: ellipsis;',
    '  white-space: nowrap;',
    '  color: var(--dsw-alias-label-tertiary, #6d7480);',
    '  flex: 1;',
    '}',
    '.dshgb-rail-actions { display: inline-flex; align-items: center; gap: 2px; flex: none; }',
    '.dshgb-icon-btn {',
    '  display: inline-flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  width: 22px;',
    '  height: 22px;',
    '  border: none;',
    '  border-radius: 6px;',
    '  background: transparent;',
    '  color: var(--dsw-alias-label-secondary, #8a919f);',
    '  cursor: pointer;',
    '  padding: 0;',
    '}',
    '.dshgb-icon-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.16)); color: var(--dsw-alias-label-primary, #e6e8ee); }',
    '.dshgb-icon-btn:disabled { opacity: .45; cursor: default; }',
    '.dshgb-rail-body {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 8px;',
    '  padding: 10px;',
    '  min-height: 0;',
    '  overflow-y: auto;',
    '}',
    '.dshgb-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
    '.dshgb-input {',
    '  flex: 1;',
    '  min-width: 0;',
    '  padding: 4px 8px;',
    '  border-radius: 8px;',
    '  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25));',
    '  background: var(--dsw-alias-bg-base, rgba(0,0,0,.15));',
    '  color: var(--dsw-alias-label-primary, #e6e8ee);',
    '  font-size: 12px;',
    '  outline: none;',
    '}',
    '.dshgb-input:focus { border-color: var(--dsw-alias-brand-primary, #4d6bfe); }',
    '.dshgb-check { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; }',
    '.dshgb-check input { accent-color: var(--dsw-alias-brand-primary, #4d6bfe); margin: 0; }',
    '.dshgb-btn {',
    '  display: inline-flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  gap: 5px;',
    '  flex: 1 1 40%;',
    '  margin: 0;',
    '  padding: 5px 8px;',
    '  border-radius: 8px;',
    '  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25));',
    '  background: var(--dsw-alias-button-tool-bar-fill, rgba(128,128,128,.1));',
    '  color: var(--dsw-alias-label-primary, #e6e8ee);',
    '  font-size: 12px;',
    '  cursor: pointer;',
    '  white-space: nowrap;',
    '}',
    '.dshgb-btn:hover:not(:disabled) { background: var(--dsw-alias-button-tool-bar-hover, rgba(128,128,128,.2)); }',
    '.dshgb-btn:disabled { opacity: .5; cursor: default; }',
    '.dshgb-btn.primary {',
    '  background: var(--dsw-alias-button-primary-fill, #4d6bfe);',
    '  border-color: transparent;',
    '  color: var(--dsw-alias-label-primary-foreground, #fff);',
    '}',
    '.dshgb-btn.primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, #3d5bfe); }',
    '.dshgb-summary { font-size: 11px; opacity: .8; }',
    '.dshgb-table-wrap { flex: 1; min-height: 60px; overflow: auto; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.1)); }',
    '.dshgb-table { width: 100%; border-collapse: collapse; }',
    '.dshgb-table th, .dshgb-table td {',
    '  text-align: left;',
    '  padding: 3px 6px;',
    '  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.08));',
    '  white-space: nowrap;',
    '}',
    '.dshgb-table th { position: sticky; top: 0; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12)); font-weight: 500; color: var(--dsw-alias-label-tertiary, #6d7480); z-index: 1; }',
    '.dshgb-table tbody tr:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.08)); }',
    '.dshgb-repo-name { color: var(--dsw-alias-label-primary, #e6e8ee); font-weight: 500; max-width: 140px; overflow: hidden; text-overflow: ellipsis; }',
    '.dshgb-branch-chip {',
    '  display: inline-flex;',
    '  align-items: center;',
    '  gap: 3px;',
    '  padding: 0 6px;',
    '  border-radius: 999px;',
    '  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12));',
    '  color: var(--dsw-alias-label-primary, #e6e8ee);',
    '  font-size: 11px;',
    '  max-width: 120px;',
    '  overflow: hidden;',
    '}',
    '.dshgb-state { font-size: 11px; }',
    '.dshgb-state .dirty { color: var(--dsw-alias-state-warn-primary, #d9a400); }',
    '.dshgb-state .clean { color: var(--dsw-alias-state-success-primary, #34c759); }',
    '.dshgb-log {',
    '  max-height: 96px;',
    '  overflow: auto;',
    '  padding: 5px 8px;',
    '  border-radius: 8px;',
    '  background: var(--dsw-alias-bg-base, rgba(0,0,0,.18));',
    '  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;',
    '  font-size: 11px;',
    '  white-space: pre-wrap;',
    '  word-break: break-all;',
    '  flex: none;',
    '}',
    '.dshgb-log .ok { color: var(--dsw-alias-state-success-primary, #34c759); }',
    '.dshgb-log .fail { color: var(--dsw-alias-state-error-primary, #ff5c5c); }',
    '.dshgb-log .info { color: var(--dsw-alias-label-tertiary, #6d7480); }',
    '.dshgb-empty { padding: 12px; text-align: center; opacity: .7; }',
    '.dshgb-spin { display: inline-block; animation: dshgb-rotate 1s linear infinite; }',
    '@keyframes dshgb-rotate { to { transform: rotate(360deg); } }',
    /* ---- collapsed tab ---- */
    '.dshgb-tab {',
    '  position: fixed;',
    '  z-index: 40;',
    '  display: flex;',
    '  flex-direction: column;',
    '  align-items: center;',
    '  gap: 4px;',
    '  padding: 8px 4px;',
    '  border-radius: 0 10px 10px 0;',
    '  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18));',
    '  border-left: none;',
    '  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.08));',
    '  color: var(--dsw-alias-label-primary, #e6e8ee);',
    '  font-size: 11px;',
    '  cursor: pointer;',
    '  box-shadow: 0 4px 14px rgba(0,0,0,.12);',
    '  user-select: none;',
    '}',
    '.dshgb-tab:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14)); }',
    '.dshgb-tab-text { writing-mode: vertical-rl; letter-spacing: 2px; opacity: .85; }',
    /* ---- tab bar ---- */
    '.dshgb-tabs {',
    '  display: flex;',
    '  gap: 2px;',
    '  padding: 2px;',
    '  border-radius: 8px;',
    '  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.1));',
    '  flex: none;',
    '}',
    '.dshgb-tab-btn {',
    '  flex: 1;',
    '  padding: 4px 0;',
    '  border: none;',
    '  border-radius: 6px;',
    '  background: transparent;',
    '  color: var(--dsw-alias-label-tertiary, #6d7480);',
    '  font-size: 11px;',
    '  cursor: pointer;',
    '  white-space: nowrap;',
    '}',
    '.dshgb-tab-btn:hover { color: var(--dsw-alias-label-secondary, #8a919f); }',
    '.dshgb-tab-btn.active { background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.16)); color: var(--dsw-alias-label-primary, #e6e8ee); }',
    '.dshgb-tab-btn:disabled { opacity: .5; cursor: default; }',
    /* ---- forms (clone / config / commit) ---- */
    '.dshgb-form { display: flex; flex-direction: column; gap: 8px; }',
    '.dshgb-form-label { font-size: 11px; color: var(--dsw-alias-label-tertiary, #6d7480); }',
    '.dshgb-form-row { display: flex; flex-direction: column; gap: 3px; }',
    '.dshgb-input-full { width: 100%; box-sizing: border-box; }',
    '.dshgb-hint { font-size: 10px; opacity: .65; line-height: 1.4; }',
  ].join('\n');

  function injectCss() {
    if (typeof document === 'undefined') return;
    if (document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]') !== null) return;
    var tag = document.createElement('style');
    tag.dataset.pluginCss = CSS_TAG;
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }

  /* ====================================================================== *
   * HTTP helpers — same-origin calls into the host half                    *
   * ====================================================================== */

  var API_BASE = '/dsh-git-branch';

  function postJson(path, body) {
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (json) {
        if (!res.ok) {
          var message = json && json.error ? json.error : ('HTTP ' + res.status);
          throw new Error(message);
        }
        return json;
      });
    });
  }

  function nowTime() {
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  /* ====================================================================== *
   * Icons (inline SVG)                                                     *
   * ====================================================================== */

  function branchIcon(h, size) {
    return h('svg', { width: size || 14, height: size || 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
      h('path', {
        d: 'M4 2.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm8 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM4 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z',
        stroke: 'currentColor', strokeWidth: '1.3',
      }),
      h('path', {
        d: 'M4 5.5v5M12 5.5c0 2.5-2.5 2.5-4.5 2.5H6',
        stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round',
      }),
    );
  }

  function refreshIcon(h) {
    return h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
      h('path', {
        d: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3',
        stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round',
      }),
    );
  }

  function collapseIcon(h) {
    return h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
      h('path', { d: 'M10 3.5L5.5 8l4.5 4.5', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),
    );
  }

  function expandIcon(h) {
    return h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
      h('path', { d: 'M6 3.5l4.5 4.5L6 12.5', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }),
    );
  }

  function spinnerIcon(h) {
    return h('span', { className: 'dshgb-spin' }, refreshIcon(h));
  }

  /* ====================================================================== *
   * Geometry — measure the conversation lane                              *
   * ====================================================================== */

  var PANEL_MIN_W = 240;
  var PANEL_MAX_W = 320;
  var PANEL_GAP = 10;
  var PANEL_LEFT_INSET = 8;
  var PANEL_BOTTOM_INSET = 8;

  /**
   * Compute the floating-panel geometry from the live DOM. Returns null when
   * the conversation scrollport is not on screen yet (first frames, hero).
   * The panel hugs the conversation column's left edge and stretches from
   * just below the header down to the bottom of the scrollport (the composer
   * stays untouched because the input card is centered on the chat axis).
   * The message column formula mirrors ConversationRoot / ChatView:
   *   content width = user drag pref, else clamp(680, column*0.64, 920)
   */
  function measureRail() {
    if (typeof document === 'undefined') return null;
    var scroll = document.querySelector('[data-conversation-scroll]');
    if (scroll === null) return null;
    var sr = scroll.getBoundingClientRect();
    if (sr.width <= 0 || sr.height <= 0) return null;

    var colW = sr.width;
    var rawW = getComputedStyle(scroll).getPropertyValue('--dsh-conversation-column-width');
    var parsedW = parseFloat(rawW);
    if (Number.isFinite(parsedW) && parsedW > 0) colW = parsedW;

    var userW = null;
    try {
      var raw = window.localStorage.getItem('dsh.conversation.contentWidth');
      if (raw !== null) {
        var w = parseFloat(raw);
        if (Number.isFinite(w) && w > 0) userW = w;
      }
    } catch { /* storage unavailable */ }
    var contentW = userW || Math.min(Math.max(680, colW * 0.64), 920);

    // Message column left edge (centered) and the full lane between the
    // column's left edge and the message column's left edge.
    var msgLeft = sr.left + Math.max(0, (sr.width - contentW)) / 2;
    var fullAvailable = msgLeft - sr.left - PANEL_GAP;

    // Width the rail may occupy without colliding with the input card: the
    // input card is contentW + 32px centered, so it extends msgLeft - 16; the
    // rail keeps PANEL_LEFT_INSET on the near side and a breathing gap on the
    // far side.
    var railAvailable = fullAvailable - PANEL_LEFT_INSET - 16;

    var top = sr.top + 8;
    // Bottom edge runs to the bottom of the scrollport (the composer card is
    // centered, so the rail fills the lane under the header without covering
    // the input).
    var bottom = sr.bottom - PANEL_BOTTOM_INSET;
    if (bottom - top < 120) bottom = top + 120;

    var railWidth = Math.max(PANEL_MIN_W, Math.min(railAvailable, PANEL_MAX_W));
    return {
      left: sr.left + PANEL_LEFT_INSET,
      top: top,
      height: bottom - top,
      available: railAvailable,
      railWidth: railWidth,
    };
  }

  /* ====================================================================== *
   * Component                                                              *
   * ====================================================================== */

  function makeGitBranchDock(react, h) {
    var useState = react.useState;
    var useEffect = react.useEffect;
    var useMemo = react.useMemo;
    var useCallback = react.useCallback;
    var useLayoutEffect = react.useLayoutEffect;

    return function GitBranchDock(props) {
      var sessionId = props.sessionId;
      var useWorkspaces = props.useWorkspaces;

      // The workspace owning the current session (path is the API key).
      // The hook is always called when present — the selector absorbs the
      // session identity so the hook order never changes between renders.
      var workspace = useWorkspaces === undefined
        ? undefined
        : useWorkspaces(function (state) {
          if (sessionId === undefined) return undefined;
          var items = state.items;
          for (var i = 0; i < items.length; i += 1) {
            if (items[i].sessionIds.indexOf(sessionId) !== -1) return items[i];
          }
          return undefined;
        });
      var wsPath = workspace === undefined ? undefined : workspace.path;
      var wsTitle = workspace === undefined ? '' : (workspace.title || workspace.path);

      // ---- panel geometry ----
      var geoInit = useState(null);
      var geo = geoInit[0];
      var setGeo = geoInit[1];

      useEffect(function () {
        if (wsPath === undefined) return undefined;
        var measure = function () { setGeo(measureRail()); };
        measure();
        // Re-measure on scrollport / seat size changes and on viewport resize.
        window.addEventListener('resize', measure);
        var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
        var observeTargets = function () {
          if (ro === null) return;
          var scroll = document.querySelector('[data-conversation-scroll]');
          var seat = document.querySelector('[data-composer-seat]');
          if (scroll !== null) ro.observe(scroll);
          if (seat !== null) ro.observe(seat);
        };
        observeTargets();
        // The scrollport may mount slightly later; retry briefly.
        var retries = 0;
        var timer = window.setInterval(function () {
          retries += 1;
          if (retries > 10) { window.clearInterval(timer); return; }
          measure();
          observeTargets();
        }, 400);
        return function () {
          window.removeEventListener('resize', measure);
          window.clearInterval(timer);
          if (ro !== null) ro.disconnect();
        };
      }, [wsPath, setGeo]);

      // ---- panel open/closed ----
      var openInit = useState(true);
      var open = openInit[0];
      var setOpen = openInit[1];

      var phaseInit = useState('idle'); // idle | loading | ready | error
      var phase = phaseInit[0];
      var setPhase = phaseInit[1];

      var errorInit = useState(null);
      var error = errorInit[0];
      var setError = errorInit[1];

      var reposInit = useState([]);
      var repos = reposInit[0];
      var setRepos = reposInit[1];

      var selectedInit = useState(function () { return {}; });
      var selected = selectedInit[0];
      var setSelected = selectedInit[1];

      var branchInit = useState('');
      var branch = branchInit[0];
      var setBranch = branchInit[1];

      var namesInit = useState(null);
      var branchNames = namesInit[0];
      var setBranchNames = namesInit[1];

      var createInit = useState(false);
      var create = createInit[0];
      var setCreate = createInit[1];

      var allowDirtyInit = useState(false);
      var allowDirty = allowDirtyInit[0];
      var setAllowDirty = allowDirtyInit[1];

      var busyInit = useState(null); // null | 'status' | 'switch' | 'pull' | 'switch-pull' | 'fetch' | 'branches' | 'push' | 'commit' | 'clone' | 'config' | 'credential'
      var busy = busyInit[0];
      var setBusy = busyInit[1];

      // ---- tab bar ----
      var tabInit = useState('branch'); // branch | sync | clone | config
      var activeTab = tabInit[0];
      var setActiveTab = tabInit[1];

      // ---- sync tab (push / commit) ----
      var pushUpstreamInit = useState(false);
      var pushUpstream = pushUpstreamInit[0];
      var setPushUpstream = pushUpstreamInit[1];
      var commitMsgInit = useState('');
      var commitMsg = commitMsgInit[0];
      var setCommitMsg = commitMsgInit[1];
      var commitAllInit = useState(true);
      var commitAll = commitAllInit[0];
      var setCommitAll = commitAllInit[1];

      // ---- clone tab ----
      var cloneUrlInit = useState('');
      var cloneUrl = cloneUrlInit[0];
      var setCloneUrl = cloneUrlInit[1];
      var cloneDirInit = useState('');
      var cloneDir = cloneDirInit[0];
      var setCloneDir = cloneDirInit[1];
      var cloneBranchInit = useState('');
      var cloneBranch = cloneBranchInit[0];
      var setCloneBranch = cloneBranchInit[1];

      // ---- config tab ----
      var cfgNameInit = useState('');
      var cfgName = cfgNameInit[0];
      var setCfgName = cfgNameInit[1];
      var cfgEmailInit = useState('');
      var cfgEmail = cfgEmailInit[0];
      var setCfgEmail = cfgEmailInit[1];
      var cfgScopeInit = useState('global');
      var cfgScope = cfgScopeInit[0];
      var setCfgScope = cfgScopeInit[1];
      var cfgLoadedInit = useState(false);
      var cfgLoaded = cfgLoadedInit[0];
      var setCfgLoaded = cfgLoadedInit[1];
      var credHostInit = useState('');
      var credHost = credHostInit[0];
      var setCredHost = credHostInit[1];
      var credUserInit = useState('');
      var credUser = credUserInit[0];
      var setCredUser = credUserInit[1];
      var credPassInit = useState('');
      var credPass = credPassInit[0];
      var setCredPass = credPassInit[1];
      var credInfoInit = useState(null); // { remoteHosts, envPath, hasToken, globalUsername, globalHasToken }
      var credInfo = credInfoInit[0];
      var setCredInfo = credInfoInit[1];

      var resultsInit = useState(function () { return {}; });
      var results = resultsInit[0];
      var setResults = resultsInit[1];

      var logInit = useState([]);
      var log = logInit[0];
      var setLog = logInit[1];

      var appendLog = useCallback(function (lines) {
        setLog(function (prev) {
          var next = prev.concat(lines);
          return next.length > 300 ? next.slice(next.length - 300) : next;
        });
      }, [setLog]);

      var loadStatus = useCallback(function (ws, keepSelection) {
        setPhase('loading');
        setError(null);
        setBusy('status');
        return postJson('/status', { ws: ws }).then(function (data) {
          setRepos(data.repos);
          setPhase('ready');
          setSelected(function (prev) {
            if (keepSelection) {
              var next = {};
              for (var i = 0; i < data.repos.length; i += 1) {
                var name = data.repos[i].name;
                next[name] = prev[name] !== undefined ? prev[name] : true;
              }
              return next;
            }
            var all = {};
            for (var j = 0; j < data.repos.length; j += 1) all[data.repos[j].name] = true;
            return all;
          });
        }).catch(function (err) {
          setPhase('error');
          setError(err.message);
        }).then(function () {
          setBusy(null);
        });
      }, [setRepos, setPhase, setSelected, setBusy, setError]);

      // Reset + load whenever the workspace changes.
      useEffect(function () {
        if (wsPath === undefined) return undefined;
        setRepos([]);
        setResults({});
        setBranchNames(null);
        setLog([]);
        loadStatus(wsPath, false);
        return undefined;
      }, [wsPath, loadStatus, setRepos, setResults, setBranchNames, setLog]);

      var selectedNames = useMemo(function () {
        var names = [];
        for (var i = 0; i < repos.length; i += 1) {
          if (selected[repos[i].name]) names.push(repos[i].name);
        }
        return names;
      }, [repos, selected]);

      var ensureBranchNames = useCallback(function () {
        if (wsPath === undefined || branchNames !== null) return;
        setBusy('branches');
        postJson('/branch-names', { ws: wsPath, repos: 'all' }).then(function (data) {
          setBranchNames(data.names || []);
        }).catch(function () {
          setBranchNames([]);
        }).then(function () {
          setBusy(function (current) { return current === 'branches' ? null : current; });
        });
      }, [wsPath, branchNames, setBranchNames, setBusy]);

      var applyResults = useCallback(function (opResults) {
        var map = {};
        var lines = [];
        for (var i = 0; i < opResults.length; i += 1) {
          var r = opResults[i];
          map[r.repo] = r;
          lines.push({
            time: nowTime(),
            repo: r.repo,
            message: r.message,
            tone: r.ok ? 'ok' : (r.skipped ? 'info' : 'fail'),
          });
        }
        setResults(map);
        appendLog(lines);
      }, [setResults, appendLog]);

      var runSwitch = useCallback(function (andPull) {
        if (wsPath === undefined || busy !== null) return;
        var target = branch.trim();
        if (target === '') {
          appendLog([{ time: nowTime(), repo: '-', message: '请先输入目标分支', tone: 'fail' }]);
          return;
        }
        var targets = selectedNames.length > 0 ? selectedNames : 'all';
        setBusy(andPull ? 'switch-pull' : 'switch');
        appendLog([{ time: nowTime(), repo: '-', message: '切换分支 → ' + target + '（' + (targets === 'all' ? '全部' : targets.length + ' 个') + '仓库）', tone: 'info' }]);
        postJson('/switch', { ws: wsPath, repos: targets, branch: target, create: create, allowDirty: allowDirty })
          .then(function (data) {
            applyResults(data.results);
            if (!andPull) return undefined;
            var okRepos = [];
            for (var i = 0; i < data.results.length; i += 1) {
              if (data.results[i].ok && !data.results[i].skipped) okRepos.push(data.results[i].repo);
            }
            if (okRepos.length === 0) return undefined;
            appendLog([{ time: nowTime(), repo: '-', message: '更新代码（' + okRepos.length + ' 个仓库）', tone: 'info' }]);
            return postJson('/pull', { ws: wsPath, repos: okRepos }).then(function (pullData) {
              applyResults(pullData.results);
              return undefined;
            });
          })
          .catch(function (err) {
            appendLog([{ time: nowTime(), repo: '-', message: err.message, tone: 'fail' }]);
          })
          .then(function () {
            setBusy(null);
            return loadStatus(wsPath, true);
          });
      }, [wsPath, busy, branch, selectedNames, create, allowDirty, appendLog, applyResults, loadStatus]);

      var runPull = useCallback(function (rebase) {
        if (wsPath === undefined || busy !== null) return;
        var targets = selectedNames.length > 0 ? selectedNames : 'all';
        setBusy(rebase ? 'rebase' : 'pull');
        appendLog([{ time: nowTime(), repo: '-', message: (rebase ? '变基更新（' : '更新代码（') + (targets === 'all' ? '全部' : targets.length + ' 个') + '仓库）', tone: 'info' }]);
        postJson('/pull', { ws: wsPath, repos: targets, rebase: rebase === true })
          .then(function (data) { applyResults(data.results); })
          .catch(function (err) {
            appendLog([{ time: nowTime(), repo: '-', message: err.message, tone: 'fail' }]);
          })
          .then(function () {
            setBusy(null);
            return loadStatus(wsPath, true);
          });
      }, [wsPath, busy, selectedNames, appendLog, applyResults, loadStatus]);

      var runFetch = useCallback(function () {
        if (wsPath === undefined || busy !== null) return;
        setBusy('fetch');
        appendLog([{ time: nowTime(), repo: '-', message: '同步远端引用（fetch --prune）', tone: 'info' }]);
        postJson('/fetch', { ws: wsPath, repos: 'all' })
          .then(function (data) { applyResults(data.results); })
          .catch(function (err) {
            appendLog([{ time: nowTime(), repo: '-', message: err.message, tone: 'fail' }]);
          })
          .then(function () {
            setBusy(null);
            return loadStatus(wsPath, true);
          });
      }, [wsPath, busy, appendLog, applyResults, loadStatus]);

      var runPush = useCallback(function () {
        if (wsPath === undefined || busy !== null) return;
        var targets = selectedNames.length > 0 ? selectedNames : 'all';
        setBusy('push');
        appendLog([{ time: nowTime(), repo: '-', message: '推送代码（' + (targets === 'all' ? '全部' : targets.length + ' 个') + '仓库' + (pushUpstream ? '，设置上游' : '') + '）', tone: 'info' }]);
        postJson('/push', { ws: wsPath, repos: targets, setUpstream: pushUpstream })
          .then(function (data) { applyResults(data.results); })
          .catch(function (err) {
            appendLog([{ time: nowTime(), repo: '-', message: err.message, tone: 'fail' }]);
          })
          .then(function () {
            setBusy(null);
            return loadStatus(wsPath, true);
          });
      }, [wsPath, busy, selectedNames, pushUpstream, appendLog, applyResults, loadStatus]);

      var runCommit = useCallback(function () {
        if (wsPath === undefined || busy !== null) return;
        var message = commitMsg.trim();
        if (message === '') {
          appendLog([{ time: nowTime(), repo: '-', message: '请先填写提交信息', tone: 'fail' }]);
          return;
        }
        var targets = selectedNames.length > 0 ? selectedNames : 'all';
        setBusy('commit');
        appendLog([{ time: nowTime(), repo: '-', message: '提交修改（' + (targets === 'all' ? '全部' : targets.length + ' 个') + '仓库' + (commitAll ? '，含未跟踪文件' : '') + '）', tone: 'info' }]);
        postJson('/commit', { ws: wsPath, repos: targets, message: message, addAll: commitAll })
          .then(function (data) { applyResults(data.results); })
          .catch(function (err) {
            appendLog([{ time: nowTime(), repo: '-', message: err.message, tone: 'fail' }]);
          })
          .then(function () {
            setBusy(null);
            return loadStatus(wsPath, true);
          });
      }, [wsPath, busy, selectedNames, commitMsg, commitAll, appendLog, applyResults, loadStatus]);

      var runClone = useCallback(function () {
        if (wsPath === undefined || busy !== null) return;
        var url = cloneUrl.trim();
        if (url === '') {
          appendLog([{ time: nowTime(), repo: '-', message: '请填写仓库地址', tone: 'fail' }]);
          return;
        }
        setBusy('clone');
        var body = { ws: wsPath, url: url };
        var dir = cloneDir.trim();
        if (dir !== '') body.dir = dir;
        if (cloneBranch.trim() !== '') body.branch = cloneBranch.trim();
        appendLog([{ time: nowTime(), repo: '-', message: '克隆 ' + url + (body.dir ? ' → ' + body.dir : ''), tone: 'info' }]);
        postJson('/clone', body)
          .then(function (data) {
            appendLog([{
              time: nowTime(),
              repo: data.dir || '-',
              message: data.message,
              tone: data.ok ? 'ok' : 'fail',
            }]);
            if (data.ok) setCloneDir('');
          })
          .catch(function (err) {
            appendLog([{ time: nowTime(), repo: '-', message: err.message, tone: 'fail' }]);
          })
          .then(function () {
            setBusy(null);
            return loadStatus(wsPath, true);
          });
      }, [wsPath, busy, cloneUrl, cloneDir, cloneBranch, appendLog, setCloneDir, loadStatus]);

      var loadConfig = useCallback(function () {
        if (wsPath === undefined || cfgLoaded) return;
        setBusy('config');
        Promise.all([
          postJson('/git-config', { ws: wsPath, action: 'get', key: 'user.name', repos: 'all' }),
          postJson('/git-config', { ws: wsPath, action: 'get', key: 'user.email', repos: 'all' }),
          postJson('/git-config', { ws: wsPath, action: 'ws-cred' }),
          postJson('/git-config', { ws: wsPath, action: 'global-cred' }),
        ]).then(function (values) {
          setCfgName(values[0].value || '');
          setCfgEmail(values[1].value || '');
          var wsCred = values[2];
          var globalCred = values[3];
          // Workspace-level defaults for the credential form: host comes from
          // the workspace .env (fall back to the first detected remote host);
          // username comes from the globally shared credential (fall back to a
          // legacy per-workspace value); token is left blank so the user never
          // re-types it unless they want to rotate it.
          setCredHost(wsCred.host || (wsCred.remoteHosts && wsCred.remoteHosts[0]) || '');
          setCredUser(globalCred.username || wsCred.username || '');
          setCredPass('');
          setCredInfo({
            remoteHosts: wsCred.remoteHosts || [],
            envPath: wsCred.envPath,
            envExists: wsCred.envExists,
            globalUsername: globalCred.username || '',
            globalHasToken: globalCred.hasToken,
            globalFile: globalCred.file || '',
          });
          setCfgLoaded(true);
        }).catch(function () {
          appendLog([{ time: nowTime(), repo: '-', message: '读取 git 配置失败', tone: 'fail' }]);
        }).then(function () {
          setBusy(null);
        });
      }, [wsPath, cfgLoaded, appendLog, setBusy, setCfgName, setCfgEmail, setCfgLoaded, setCredHost, setCredUser, setCredPass, setCredInfo]);

      var saveConfig = useCallback(function () {
        if (wsPath === undefined || busy !== null) return;
        var ops = [];
        if (cfgName !== '') {
          ops.push({ key: 'user.name', value: cfgName });
        }
        if (cfgEmail !== '') {
          ops.push({ key: 'user.email', value: cfgEmail });
        }
        if (ops.length === 0) return;
        setBusy('config');
        var chain = Promise.resolve();
        ops.forEach(function (op) {
          chain = chain.then(function () {
            appendLog([{ time: nowTime(), repo: '-', message: '设置 ' + op.key + ' = ' + op.value, tone: 'info' }]);
            return postJson('/git-config', {
              ws: wsPath,
              action: 'set-kv',
              scope: cfgScope,
              key: op.key,
              value: op.value,
              repos: 'all',
            }).then(function (data) {
              for (var i = 0; i < data.results.length; i += 1) {
                appendLog([{
                  time: nowTime(),
                  repo: data.results[i].repo,
                  message: data.results[i].message,
                  tone: data.results[i].ok ? 'ok' : 'fail',
                }]);
              }
            });
          });
        });
        chain.catch(function (err) {
          appendLog([{ time: nowTime(), repo: '-', message: err.message, tone: 'fail' }]);
        }).then(function () {
          setBusy(null);
          return loadStatus(wsPath, true);
        });
      }, [wsPath, busy, cfgName, cfgEmail, cfgScope, appendLog, loadStatus]);

      var runCredential = useCallback(function () {
        if (wsPath === undefined || busy !== null) return;
        var host = credHost.trim();
        var username = credUser.trim();
        var password = credPass;
        if (host === '' || username === '') {
          appendLog([{ time: nowTime(), repo: '-', message: '请填写 host 与用户名（密码可选，留空保留原值）', tone: 'fail' }]);
          return;
        }
        setBusy('credential');
        appendLog([{ time: nowTime(), repo: '-', message: '保存凭证 → ' + host + '（全局账号 + 当前工作区）', tone: 'info' }]);
        postJson('/git-config', {
          ws: wsPath,
          action: 'save-ws-cred',
          host: host,
          username: username,
          token: password,
        })
          .then(function (data) {
            appendLog([{ time: nowTime(), repo: '-', message: data.message, tone: data.ok ? 'ok' : 'fail' }]);
            if (data.ok) {
              setCredPass('');
              // Reflect the new state without a full reload.
              setCredInfo(function (prev) {
                return prev === null ? prev : {
                  remoteHosts: prev.remoteHosts,
                  envPath: prev.envPath,
                  envExists: true,
                  globalUsername: username,
                  globalHasToken: password !== '' || prev.globalHasToken,
                  globalFile: data.globalFile || prev.globalFile,
                };
              });
            }
          })
          .catch(function (err) {
            appendLog([{ time: nowTime(), repo: '-', message: err.message, tone: 'fail' }]);
          })
          .then(function () { setBusy(null); });
      }, [wsPath, busy, credHost, credUser, credPass, appendLog, setCredHost, setCredUser, setCredPass, setCredInfo]);

      // Auto-load the config/credential data when the user opens the 配置 tab
      // (also keeps the lazy loadConfig on focus as a fallback).
      useEffect(function () {
        if (wsPath === undefined) return undefined;
        if (activeTab === 'config') loadConfig();
        return undefined;
      }, [activeTab, wsPath, loadConfig]);

      if (wsPath === undefined) return null;

      // On very first render geo is still null (SSR / first paint); render
      // nothing until the first measurement lands, then show the rail.
      if (geo === null) return null;

      var allSelected = repos.length > 0 && selectedNames.length === repos.length;

      var toggleAll = function () {
        setSelected(function () {
          var next = {};
          var value = !allSelected;
          for (var i = 0; i < repos.length; i += 1) next[repos[i].name] = value;
          return next;
        });
      };

      var toggleOne = function (name) {
        setSelected(function (prev) {
          var next = {};
          for (var key in prev) if (Object.prototype.hasOwnProperty.call(prev, key)) next[key] = prev[key];
          next[name] = !prev[name];
          return next;
        });
      };

      var summary = '';
      if (phase === 'ready' && repos.length > 0) {
        var byBranch = {};
        var dirtyCount = 0;
        var behindCount = 0;
        for (var i = 0; i < repos.length; i += 1) {
          var repo = repos[i];
          byBranch[repo.branch] = (byBranch[repo.branch] || 0) + 1;
          if (repo.dirty + repo.staged + repo.untracked > 0) dirtyCount += 1;
          if (repo.behind > 0) behindCount += 1;
        }
        var branchParts = [];
        for (var branchName in byBranch) {
          if (Object.prototype.hasOwnProperty.call(byBranch, branchName)) {
            branchParts.push(branchName + '×' + byBranch[branchName]);
          }
        }
        branchParts.sort();
        summary = repos.length + ' 个仓库 · ' + branchParts.join('，');
        if (dirtyCount > 0) summary += ' · ' + dirtyCount + ' 个有修改';
        if (behindCount > 0) summary += ' · ' + behindCount + ' 个落后远端';
      } else if (phase === 'loading') {
        summary = '扫描中…';
      } else if (phase === 'error') {
        summary = '扫描失败：' + (error || '');
      }

      var busyAny = busy !== null;

      // ---- collapsed tab ----
      if (!open || geo.available < PANEL_MIN_W) {
        var tabStyle = { left: Math.max(4, geo.left), top: geo.top + 80, height: Math.min(geo.height - 160, 220) };
        return h('div', {
          className: 'dshgb-tab',
          style: tabStyle,
          role: 'button',
          title: '展开 Git 分支面板',
          onClick: function () { setOpen(true); },
        },
          h('span', { className: 'dshgb-rail-icon' }, branchIcon(h, 14)),
          h('span', { className: 'dshgb-tab-text' }, 'Git'),
        );
      }

      // ---- expanded rail ----
      var railStyle = {
        left: geo.left,
        top: geo.top,
        height: geo.height,
        width: geo.railWidth,
      };

      // Shared repo table (branch + sync tabs).
      var repoTable = h('div', { className: 'dshgb-table-wrap' },
        h('table', { className: 'dshgb-table' },
          h('thead', null,
            h('tr', null,
              h('th', { style: { width: 24 } },
                h('input', { type: 'checkbox', checked: allSelected, disabled: busyAny, onChange: toggleAll, title: '全选' })),
              h('th', null, '仓库'),
              h('th', null, '分支'),
              h('th', null, '状态'),
            ),
          ),
          h('tbody', null, repos.map(function (repo) {
            var result = results[repo.name];
            var changes = repo.dirty + repo.staged + repo.untracked;
            var stateBits = [];
            if (changes > 0) stateBits.push(h('span', { key: 'd', className: 'dirty' }, '● ' + changes));
            if (repo.ahead > 0 || repo.behind > 0) {
              stateBits.push(h('span', { key: 'ab', className: 'clean' }, '↑' + repo.ahead + '↓' + repo.behind));
            }
            if (stateBits.length === 0 && result !== undefined) {
              stateBits.push(h('span', {
                key: 'r',
                className: result.ok ? 'clean' : 'dirty',
                title: result.message,
              }, result.ok ? '✓' : '✗'));
            }
            if (stateBits.length === 0) stateBits.push(h('span', { key: 'c', className: 'clean' }, '✓'));
            return h('tr', { key: repo.name },
              h('td', null,
                h('input', {
                  type: 'checkbox',
                  checked: !!selected[repo.name],
                  disabled: busyAny,
                  onChange: function () { toggleOne(repo.name); },
                })),
              h('td', {
                className: 'dshgb-repo-name',
                title: (repo.name === '.' ? wsPath : wsPath + '/' + repo.name) +
                  (result !== undefined ? '\n' + result.message : ''),
              }, repo.name === '.' ? '(工作区根)' : repo.name),
              h('td', null, h('span', { className: 'dshgb-branch-chip' }, branchIcon(h, 10),
                repo.detached ? repo.branch : repo.branch)),
              h('td', { className: 'dshgb-state' }, stateBits),
            );
          })),
        ),
      );

      // Tab: branch switching (original behavior).
      var tabBranch = h('div', { className: 'dshgb-form' },
        h('div', { className: 'dshgb-row' },
          h('input', {
            className: 'dshgb-input',
            list: 'dshgb-branch-names',
            placeholder: '目标分支，如 test',
            value: branch,
            disabled: busyAny,
            onFocus: ensureBranchNames,
            onChange: function (e) { setBranch(e.target.value); },
            onKeyDown: function (e) {
              if (e.key === 'Enter') { e.preventDefault(); runSwitch(false); }
            },
          }),
          h('datalist', { id: 'dshgb-branch-names' },
            (branchNames || []).map(function (name) {
              return h('option', { key: name, value: name });
            })),
        ),
        h('div', { className: 'dshgb-row' },
          h('label', { className: 'dshgb-check' },
            h('input', { type: 'checkbox', checked: create, disabled: busyAny, onChange: function (e) { setCreate(e.target.checked); } }),
            '新建'),
          h('label', { className: 'dshgb-check' },
            h('input', { type: 'checkbox', checked: allowDirty, disabled: busyAny, onChange: function (e) { setAllowDirty(e.target.checked); } }),
            '允许修改'),
        ),
        h('div', { className: 'dshgb-row' },
          h('button', {
            type: 'button', className: 'dshgb-btn primary', disabled: busyAny || branch.trim() === '',
            onClick: function () { runSwitch(false); },
          }, busy === 'switch' || busy === 'switch-pull' ? spinnerIcon(h) : branchIcon(h, 12), '切换'),
          h('button', {
            type: 'button', className: 'dshgb-btn', disabled: busyAny,
            onClick: function () { runSwitch(true); },
          }, '切换并更新'),
        ),
        phase === 'ready' && repos.length === 0
          ? h('div', { className: 'dshgb-empty' }, '该工作区下没有找到 git 仓库')
          : repoTable,
        phase === 'error' ? h('div', { className: 'dshgb-empty' }, '扫描失败：' + (error || '未知错误')) : null,
      );

      // Tab: sync (fetch / pull) + push + commit.
      var tabSync = h('div', { className: 'dshgb-form' },
        h('div', { className: 'dshgb-summary' },
          selectedNames.length > 0
            ? '已选 ' + selectedNames.length + '/' + repos.length + ' 个仓库'
            : summary),
        h('div', { className: 'dshgb-row' },
          h('button', {
            type: 'button', className: 'dshgb-btn primary', disabled: busyAny,
            onClick: function () { runPull(false); },
          }, busy === 'pull' || busy === 'rebase' ? spinnerIcon(h) : null, '更新代码'),
          h('button', {
            type: 'button', className: 'dshgb-btn', disabled: busyAny, title: '分叉时把本地提交变基到远端之上',
            onClick: function () { runPull(true); },
          }, busy === 'rebase' ? spinnerIcon(h) : null, '变基更新'),
        ),
        h('div', { className: 'dshgb-row' },
          h('button', {
            type: 'button', className: 'dshgb-btn', disabled: busyAny,
            onClick: runFetch,
          }, busy === 'fetch' ? spinnerIcon(h) : null, '同步远端'),
          h('button', {
            type: 'button', className: 'dshgb-btn', disabled: busyAny,
            onClick: runPush,
          }, busy === 'push' ? spinnerIcon(h) : null, '推送'),
          h('label', { className: 'dshgb-check', style: { flex: 1 } },
            h('input', { type: 'checkbox', checked: pushUpstream, disabled: busyAny, onChange: function (e) { setPushUpstream(e.target.checked); } }),
            '设上游'),
        ),
        h('div', { className: 'dshgb-form-row' },
          h('span', { className: 'dshgb-form-label' }, '提交信息'),
          h('input', {
            className: 'dshgb-input dshgb-input-full',
            placeholder: 'git commit -m …',
            value: commitMsg,
            disabled: busyAny,
            onChange: function (e) { setCommitMsg(e.target.value); },
            onKeyDown: function (e) {
              if (e.key === 'Enter') { e.preventDefault(); runCommit(); }
            },
          }),
        ),
        h('div', { className: 'dshgb-row' },
          h('button', {
            type: 'button', className: 'dshgb-btn', disabled: busyAny || commitMsg.trim() === '',
            onClick: runCommit,
          }, busy === 'commit' ? spinnerIcon(h) : null, '提交'),
          h('label', { className: 'dshgb-check', style: { flex: 1 } },
            h('input', { type: 'checkbox', checked: commitAll, disabled: busyAny, onChange: function (e) { setCommitAll(e.target.checked); } }),
            '含全部改动'),
        ),
        phase === 'ready' && repos.length === 0
          ? h('div', { className: 'dshgb-empty' }, '该工作区下没有找到 git 仓库')
          : repoTable,
      );

      // Tab: clone a repository into the workspace.
      var tabClone = h('div', { className: 'dshgb-form' },
        h('div', { className: 'dshgb-form-row' },
          h('span', { className: 'dshgb-form-label' }, '仓库地址（http(s)://、git@host:、ssh:// 或本地路径）'),
          h('input', {
            className: 'dshgb-input dshgb-input-full',
            placeholder: 'https://github.com/owner/repo.git',
            value: cloneUrl,
            disabled: busyAny,
            onChange: function (e) { setCloneUrl(e.target.value); },
            onKeyDown: function (e) {
              if (e.key === 'Enter') { e.preventDefault(); runClone(); }
            },
          }),
        ),
        h('div', { className: 'dshgb-form-row' },
          h('span', { className: 'dshgb-form-label' }, '目录名（留空自动取仓库名）'),
          h('input', {
            className: 'dshgb-input dshgb-input-full',
            placeholder: '自动',
            value: cloneDir,
            disabled: busyAny,
            onChange: function (e) { setCloneDir(e.target.value); },
          }),
        ),
        h('div', { className: 'dshgb-form-row' },
          h('span', { className: 'dshgb-form-label' }, '指定分支（可选）'),
          h('input', {
            className: 'dshgb-input dshgb-input-full',
            placeholder: '如 main',
            value: cloneBranch,
            disabled: busyAny,
            onChange: function (e) { setCloneBranch(e.target.value); },
            onKeyDown: function (e) {
              if (e.key === 'Enter') { e.preventDefault(); runClone(); }
            },
          }),
        ),
        h('button', {
          type: 'button', className: 'dshgb-btn primary', disabled: busyAny || cloneUrl.trim() === '',
          onClick: runClone,
        }, busy === 'clone' ? spinnerIcon(h) : null, '克隆到工作区'),
      );

      // Tab: git identity + credentials.
      var onFocusConfig = h('input', {
        type: 'text',
        style: { display: 'none' },
        onFocus: function () {
          if (!cfgLoaded) loadConfig();
        },
      });

      var tabConfig = h('div', { className: 'dshgb-form' },
        onFocusConfig,
        h('div', { className: 'dshgb-row' },
          h('label', { className: 'dshgb-check' },
            h('input', {
              type: 'radio',
              name: 'dshgb-cfg-scope',
              checked: cfgScope === 'global',
              disabled: busyAny,
              onChange: function () { setCfgScope('global'); setCfgLoaded(false); },
            }),
            '全局'),
          h('label', { className: 'dshgb-check' },
            h('input', {
              type: 'radio',
              name: 'dshgb-cfg-scope',
              checked: cfgScope === 'local',
              disabled: busyAny,
              onChange: function () { setCfgScope('local'); setCfgLoaded(false); },
            }),
            '仓库级'),
          h('button', {
            type: 'button',
            className: 'dshgb-icon-btn',
            title: '重新读取配置',
            disabled: busyAny,
            onClick: function () { setCfgLoaded(false); },
          }, refreshIcon(h)),
        ),
        h('div', { className: 'dshgb-form-row' },
          h('span', { className: 'dshgb-form-label' }, '用户名 user.name'),
          h('input', {
            className: 'dshgb-input dshgb-input-full',
            placeholder: 'git 提交者姓名',
            value: cfgName,
            disabled: busyAny,
            onChange: function (e) { setCfgName(e.target.value); },
          }),
        ),
        h('div', { className: 'dshgb-form-row' },
          h('span', { className: 'dshgb-form-label' }, '邮箱 user.email'),
          h('input', {
            className: 'dshgb-input dshgb-input-full',
            placeholder: 'name@example.com',
            value: cfgEmail,
            disabled: busyAny,
            onChange: function (e) { setCfgEmail(e.target.value); },
          }),
        ),
        h('button', {
          type: 'button', className: 'dshgb-btn', disabled: busyAny,
          onClick: saveConfig,
        }, busy === 'config' ? spinnerIcon(h) : null, '保存身份配置'),
        h('div', { className: 'dshgb-row' },
          h('span', { className: 'dshgb-form-label', style: { flex: 1 } }, '仓库凭证（host + 账号）'),
        ),
        h('div', { className: 'dshgb-hint' },
          'host 写入当前工作区 .env；账号密码全局共用（所有仓库一致），保存在' +
          (credInfo && credInfo.globalFile ? ' ' + credInfo.globalFile : ' 全局凭证文件') +
          '。子仓库 remote host：' +
          ((credInfo && credInfo.remoteHosts && credInfo.remoteHosts.length > 0)
            ? credInfo.remoteHosts.join('、')
            : '（未检测到）'),
        ),
        h('div', { className: 'dshgb-form-row' },
          h('input', {
            className: 'dshgb-input dshgb-input-full',
            list: 'dshgb-remote-hosts',
            placeholder: 'host，如 gitlab.example.com',
            value: credHost,
            disabled: busyAny,
            onChange: function (e) { setCredHost(e.target.value); },
          }),
          h('datalist', { id: 'dshgb-remote-hosts' },
            (credInfo && credInfo.remoteHosts || []).map(function (host) {
              return h('option', { key: host, value: host });
            })),
        ),
        h('div', { className: 'dshgb-row' },
          h('input', {
            className: 'dshgb-input',
            placeholder: '用户名（全局，所有仓库共用）' + (credInfo && credInfo.globalUsername ? '，当前：' + credInfo.globalUsername : ''),
            value: credUser,
            disabled: busyAny,
            onChange: function (e) { setCredUser(e.target.value); },
          }),
          h('input', {
            className: 'dshgb-input',
            type: 'password',
            placeholder: '密码 / token' + (credInfo && credInfo.globalHasToken ? '（已设置，留空保留）' : ''),
            value: credPass,
            disabled: busyAny,
            onChange: function (e) { setCredPass(e.target.value); },
          }),
        ),
        h('div', { className: 'dshgb-row' },
          h('button', {
            type: 'button', className: 'dshgb-btn primary', disabled: busyAny,
            onClick: runCredential,
          }, busy === 'credential' ? spinnerIcon(h) : null, '保存'),
          h('span', { className: 'dshgb-hint', style: { flex: 1 } },
            (credInfo && credInfo.globalHasToken ? '全局已存账号密码' : '全局尚无账号密码') +
            '；host 按工作区配置，各仓库共用同一套账号'),
        ),
      );

      var tabBody = activeTab === 'sync'
        ? tabSync
        : activeTab === 'clone'
          ? tabClone
          : activeTab === 'config'
            ? tabConfig
            : tabBranch;

      // Always render repo table on branch tab; sync tab shares it above.
      var railBody = h('div', { className: 'dshgb-rail-body' },
        h('div', { className: 'dshgb-tabs' },
          h('button', { type: 'button', className: 'dshgb-tab-btn' + (activeTab === 'branch' ? ' active' : ''), onClick: function () { setActiveTab('branch'); } }, '分支'),
          h('button', { type: 'button', className: 'dshgb-tab-btn' + (activeTab === 'sync' ? ' active' : ''), onClick: function () { setActiveTab('sync'); } }, '同步'),
          h('button', { type: 'button', className: 'dshgb-tab-btn' + (activeTab === 'clone' ? ' active' : ''), onClick: function () { setActiveTab('clone'); } }, '克隆'),
          h('button', { type: 'button', className: 'dshgb-tab-btn' + (activeTab === 'config' ? ' active' : ''), onClick: function () { setActiveTab('config'); } }, '配置'),
        ),
        tabBody,
        log.length > 0 ? h('div', { className: 'dshgb-log' },
          log.map(function (line, index) {
            return h('div', { key: index, className: line.tone },
              '[' + line.time + '] ' + line.repo + '：' + line.message);
          })) : null,
      );

      return h('div', { className: 'dshgb-rail', style: railStyle },
        h('div', { className: 'dshgb-rail-head' },
          h('span', { className: 'dshgb-rail-icon' }, branchIcon(h, 14)),
          h('span', { className: 'dshgb-rail-title' }, 'Git 分支'),
          h('span', { className: 'dshgb-rail-ws', title: wsPath }, wsTitle),
          h('span', { className: 'dshgb-rail-actions' },
            h('button', {
              type: 'button',
              className: 'dshgb-icon-btn',
              title: '刷新',
              disabled: busyAny,
              onClick: function () { loadStatus(wsPath, true); },
            }, busy === 'status' ? spinnerIcon(h) : refreshIcon(h)),
            h('button', {
              type: 'button',
              className: 'dshgb-icon-btn',
              title: '折叠',
              onClick: function () { setOpen(false); },
            }, collapseIcon(h)),
          ),
        ),
        railBody,
      );
    };
  }

  /* ====================================================================== *
   * Module factory — the __ModuleLoader__ contract                         *
   * ====================================================================== */

  function makeFactory() {
    return function factory(require) {
      var react = require('react');
      var jsxRuntime = require('react/jsx-runtime');

      // createElement-style helper over the automatic jsx runtime:
      // children arrive as rest args, key moves to the runtime's key slot.
      var h = function h(type, props) {
        var children = [];
        for (var i = 2; i < arguments.length; i += 1) {
          var child = arguments[i];
          if (child === null || child === undefined || child === false) continue;
          children.push(child);
        }
        var config = {};
        var source = props || {};
        for (var key in source) {
          if (Object.prototype.hasOwnProperty.call(source, key) && key !== 'key') config[key] = source[key];
        }
        if (children.length === 1) config.children = children[0];
        else if (children.length > 1) config.children = children;
        var elementKey = source.key;
        return children.length > 1
          ? jsxRuntime.jsxs(type, config, elementKey)
          : jsxRuntime.jsx(type, config, elementKey);
      };

      var GitBranchDock = makeGitBranchDock(react, h);

      return {
        name: 'git-branch',
        inject: ['slots'],
        apply: function apply(ctx) {
          injectCss();
          // Keep the conversation.input.dock registration: it gives this entry
          // the session scope + useWorkspaces kit and ties the lifecycle to a
          // selected session, but the component renders as a fixed sidebar in
          // the lane left of the message column instead of occupying the dock.
          ctx.slots.inject('conversation.input.dock', function* () {
            yield ctx.slots.register({
              name: 'conversation.input.dock',
              id: 'git-branch',
              order: 20,
            }, GitBranchDock);
          });
        },
      };
    };
  }

  if (typeof window !== 'undefined' && window.__ModuleLoader__ && typeof window.__ModuleLoader__.load === 'function') {
    window.__ModuleLoader__.load({
      id: 'dsh-git-branch',
      factory: makeFactory(),
    });
  } else {
    console.warn('[dsh-git-branch] window.__ModuleLoader__ unavailable — client half not loaded');
  }
})();