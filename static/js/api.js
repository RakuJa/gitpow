/**
 * API wrapper for GitPow
 * Converts HTTP-style API calls to Tauri IPC commands
 * Extracted from script.js for better maintainability
 */

// ============================================================================
// Tauri API Wrapper
// ============================================================================

/**
 * Main API function - handles both Tauri IPC and HTTP fallback
 * @param {string} path - API path (e.g., "/api/repos")
 * @param {Object} options - Fetch-like options (method, body, signal, etc.)
 * @returns {Promise<any>} API response
 */
async function api(path, options = {}) {
  // Check if we're running in Tauri
  // In Tauri 2.0, the API is injected as window.__TAURI__
  // Also check for __TAURI_INTERNALS__ for compatibility
  const isTauri = typeof window.__TAURI__ !== 'undefined' ||
                  typeof window.__TAURI_INTERNALS__ !== 'undefined' ||
                  (typeof window !== 'undefined' && window.location && window.location.protocol === 'tauri:');

  if (!isTauri) {
    // Fallback to fetch for development (when not in Tauri)
    return fetchFallback(path, options);
  }

  // Parse URL path and convert to Tauri command
  const { command, args } = mapPathToCommand(path, options);

  // Call Tauri command
  return invokeTauriCommand(command, args);
}

/**
 * HTTP fetch fallback for non-Tauri environments
 * @param {string} path - API path
 * @param {Object} options - Fetch options
 * @returns {Promise<any>} Response data
 */
async function fetchFallback(path, options) {
  const { signal, ...rest } = options;
  if (signal) {
    try {
      const res = await fetch(path, { ...rest, signal });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || res.statusText);
      }
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) return res.json();
      return res.text();
    } catch (error) {
      throw error;
    }
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(path, { ...rest, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || res.statusText);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return res.json();
    return res.text();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error("Request timed out after 30 seconds");
    }
    throw error;
  }
}

/**
 * Map API path to Tauri command and arguments
 * @param {string} path - API path
 * @param {Object} options - Request options
 * @returns {Object} { command, args }
 */
function mapPathToCommand(path, options) {
  const url = new URL(path, window.location.origin);
  const pathParts = url.pathname.split('/').filter(p => p);

  // Extract query parameters
  const queryParams = {};
  url.searchParams.forEach((value, key) => {
    queryParams[key] = value;
  });

  // Extract body from options
  let body = null;
  if (options.body) {
    if (typeof options.body === 'string') {
      try {
        body = JSON.parse(options.body);
      } catch {
        body = options.body;
      }
    } else {
      body = options.body;
    }
  }

  // Map API paths to Tauri commands
  let command = null;
  let args = {};

  // /api/config
  if (pathParts.length === 2 && pathParts[0] === 'api' && pathParts[1] === 'config') {
    command = 'get_config';
  }
  // /api/browse/projects-root
  else if (pathParts.length === 3 && pathParts[0] === 'api' && pathParts[1] === 'browse' && pathParts[2] === 'projects-root') {
    command = 'browse_projects_root';
  }
  // /api/repos
  else if (pathParts.length === 2 && pathParts[0] === 'api' && pathParts[1] === 'repos') {
    command = 'get_repos';
    // Tauri command expects Option<GetReposRequest> parameter
    // Always pass the request object
    if (queryParams.repos_root) {
      args = { request: { repos_root: queryParams.repos_root } };
    } else {
      // Pass request with repos_root as null, or omit request entirely
      args = { request: { repos_root: null } };
    }
  }
  // /api/repos/:repo/branches
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'branches') {
    command = 'get_branches';
    args = {
      params: {
        repo: decodeURIComponent(pathParts[2]),
        auto_fetch: queryParams.auto_fetch !== undefined ? queryParams.auto_fetch === 'true' : true
      }
    };
  }
  // /api/branch-ahead-behind
  else if (pathParts.length === 2 && pathParts[0] === 'api' && pathParts[1] === 'branch-ahead-behind') {
    command = 'get_branch_ahead_behind';
    args = {
      params: {
        repo: queryParams.repo,
        branch: queryParams.branch
      }
    };
  }
  // /api/branch-creation
  else if (pathParts.length === 2 && pathParts[0] === 'api' && pathParts[1] === 'branch-creation') {
    command = 'get_branch_creation';
    args = {
      params: {
        repo: queryParams.repo,
        branch: queryParams.branch
      }
    };
  }
  // /api/repos/:repo/commits
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'commits') {
    command = 'get_commits';
    const params = {
      repo: decodeURIComponent(pathParts[2])
    };
    if (queryParams.branch) params.branch = queryParams.branch;
    if (queryParams.limit) params.limit = parseInt(queryParams.limit, 10);
    if (queryParams.mode) params.mode = queryParams.mode;
    if (queryParams.main_branch) params.main_branch = queryParams.main_branch;
    args = { params };
  }
  // /api/repos/:repo/commits-all-branches
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'commits-all-branches') {
    command = 'get_commits_all_branches';
    const params = {
      repo: decodeURIComponent(pathParts[2])
    };
    if (queryParams.limit) params.limit = parseInt(queryParams.limit, 10);
    args = { params };
  }
  // /api/repos/:repo/commits-between
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'commits-between') {
    command = 'get_commits_between';
    args = {
      params: {
        repo: decodeURIComponent(pathParts[2]),
        from: queryParams.from,
        to: queryParams.to
      }
    };
  }
  // /api/repos/:repo/commits/metrics
  else if (pathParts.length === 5 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'commits' && pathParts[4] === 'metrics') {
    command = 'get_commit_metrics';
    const params = {
      repo: decodeURIComponent(pathParts[2])
    };
    if (queryParams.branch) params.branch = queryParams.branch;
    if (queryParams.limit) params.limit = parseInt(queryParams.limit, 10);
    args = { params };
  }
  // /api/repos/:repo/tags
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'tags') {
    command = 'get_tags';
    // get_tags takes repo as a direct String parameter, not a struct
    args = {
      repo: decodeURIComponent(pathParts[2])
    };
  }
  // /api/repos/:repo/files
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'files') {
    command = 'get_files';
    const params = {
      repo: decodeURIComponent(pathParts[2])
    };
    // Rust expects "ref" (not "ref_") due to serde rename
    if (queryParams.ref) params.ref = queryParams.ref;
    if (queryParams.path) params.path = queryParams.path;
    args = { params };
  }
  // /api/repos/:repo/commit/files
  else if (pathParts.length === 5 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'commit' && pathParts[4] === 'files') {
    command = 'get_commit_files';
    const params = {
      repo: decodeURIComponent(pathParts[2])
    };
    // ref is required for get_commit_files - Rust expects "ref" (not "ref_") due to serde rename
    if (queryParams.ref !== undefined && queryParams.ref !== null && queryParams.ref !== '') {
      params.ref = queryParams.ref;
      console.log(`[API] get_commit_files: Setting ref to: ${queryParams.ref}`);
    } else {
      console.warn(`[API] get_commit_files: ref parameter missing or empty! queryParams:`, queryParams);
    }
    if (queryParams.path !== undefined && queryParams.path !== null) {
      params.path = queryParams.path;
    }
    args = { params };
  }
  // /api/repos/:repo/file
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'file') {
    command = 'get_file';
    const params = {
      repo: decodeURIComponent(pathParts[2])
    };
    // Rust expects "ref" (not "ref_") due to serde rename
    if (queryParams.ref) params.ref = queryParams.ref;
    if (queryParams.path) params.path = queryParams.path;
    args = { params };
  }
  // /api/repos/:repo/file-creation
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'file-creation') {
    command = 'get_file_creation';
    const params = {
      repo: decodeURIComponent(pathParts[2])
    };
    if (queryParams.path) params.path = queryParams.path;
    args = { params };
  }
  // /api/repos/:repo/file-creation-batch
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'file-creation-batch') {
    command = 'get_file_creation_batch';
    const params = {
      repo: decodeURIComponent(pathParts[2])
    };
    if (queryParams.paths) params.paths = queryParams.paths;
    args = { params };
  }
  // /api/repos/:repo/image
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'image') {
    command = 'get_image';
    const params = {
      repo: decodeURIComponent(pathParts[2])
    };
    // Rust expects "ref" (not "ref_") due to serde rename
    if (queryParams.ref) params.ref = queryParams.ref;
    if (queryParams.path) params.path = queryParams.path;
    args = { params };
  }
  // /api/repos/:repo/diff
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'diff') {
    command = 'get_diff';
    const params = {
      repo: decodeURIComponent(pathParts[2])
    };
    if (queryParams.path) params.path = queryParams.path;
    // Rust expects "ref" (not "ref_") due to serde rename
    if (queryParams.ref) params.ref = queryParams.ref;
    if (queryParams.staged) params.staged = queryParams.staged;
    args = { params };
  }
  // /api/repos/:repo/status
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'status') {
    command = 'get_status';
    // get_status takes repo as a direct String parameter, not a struct
    args = {
      repo: decodeURIComponent(pathParts[2])
    };
  }
  // /api/repos/:repo/stage (POST)
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'stage') {
    command = 'stage';
    const req = {
      repo: decodeURIComponent(pathParts[2])
    };
    if (body) {
      req.path = body.path;
      req.hunks = body.hunks;
    }
    args = { req };
  }
  // /api/repos/:repo/unstage (POST)
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'unstage') {
    command = 'unstage';
    const req = {
      repo: decodeURIComponent(pathParts[2])
    };
    if (body) {
      req.path = body.path;
    }
    args = { req };
  }
  // /api/repos/:repo/commit (POST)
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'commit') {
    command = 'commit';
    const req = {
      repo: decodeURIComponent(pathParts[2])
    };
    if (body) {
      req.message = body.message;
    }
    args = { req };
  }
  // /api/repos/:repo/fetch (POST)
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'fetch') {
    command = 'fetch_repo';
    args.repo = decodeURIComponent(pathParts[2]);
  }
  // /api/repos/:repo/rebase/preview
  else if (pathParts.length === 5 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'rebase' && pathParts[4] === 'preview') {
    command = 'get_rebase_preview';
    args.repo = decodeURIComponent(pathParts[2]);
    if (queryParams.onto) args.onto = queryParams.onto;
    if (queryParams.from) args.from = queryParams.from;
  }
  // /api/repos/:repo/rebase/plan (POST)
  else if (pathParts.length === 5 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'rebase' && pathParts[4] === 'plan') {
    command = 'post_rebase_plan';
    args.repo = decodeURIComponent(pathParts[2]);
    if (body) {
      args.onto = body.onto;
      args.plan = body.plan;
      args.dry_run = body.dry_run;
    }
  }
  // /api/repos/:repo/conflicts
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'conflicts') {
    command = 'get_conflicts';
    args.repo = decodeURIComponent(pathParts[2]);
  }
  // /api/repos/:repo/conflicts/file
  else if (pathParts.length === 5 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'conflicts' && pathParts[4] === 'file') {
    command = 'get_conflict_file';
    args.repo = decodeURIComponent(pathParts[2]);
    if (queryParams.path) args.path = queryParams.path;
  }
  // /api/repos/:repo/conflicts/resolve (POST)
  else if (pathParts.length === 5 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'conflicts' && pathParts[4] === 'resolve') {
    command = 'resolve_conflict';
    args.repo = decodeURIComponent(pathParts[2]);
    if (body) {
      args.path = body.path;
      args.content = body.content;
    }
  }
  // /api/repos/:repo/open-explorer
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'open-explorer') {
    command = 'open_explorer';
    args.repo = decodeURIComponent(pathParts[2]);
    if (queryParams.path) args.path = queryParams.path;
  }
  // /api/repos/:repo/pull (POST)
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'pull') {
    command = 'pull_repo';
    args.repo = decodeURIComponent(pathParts[2]);
  }
  // /api/repos/:repo/push (POST)
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'push') {
    command = 'push_repo';
    args.repo = decodeURIComponent(pathParts[2]);
  }
  // /api/repos/:repo/branch-status
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'branch-status') {
    command = 'get_branch_status';
    args = { params: { repo: decodeURIComponent(pathParts[2]) } };
  }
  // /api/repos/:repo/stash
  else if (pathParts.length === 4 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'stash') {
    command = 'stash_list';
    args.repo = decodeURIComponent(pathParts[2]);
  }
  // /api/repos/:repo/stash/push (POST)
  else if (pathParts.length === 5 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'stash' && pathParts[4] === 'push') {
    command = 'stash_push';
    args.repo = decodeURIComponent(pathParts[2]);
    if (body && body.message) {
      args.message = body.message;
    } else if (queryParams.message) {
      args.message = queryParams.message;
    }
  }
  // /api/repos/:repo/stash/pop (POST)
  else if (pathParts.length === 5 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'stash' && pathParts[4] === 'pop') {
    command = 'stash_pop';
    args.repo = decodeURIComponent(pathParts[2]);
  }
  // /api/repos/:repo/stash/apply (POST)
  else if (pathParts.length === 5 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'stash' && pathParts[4] === 'apply') {
    command = 'stash_apply';
    args.repo = decodeURIComponent(pathParts[2]);
    if (queryParams.ref) args.stash_ref = queryParams.ref;
  }
  // /api/repos/:repo/stash/drop (POST)
  else if (pathParts.length === 5 && pathParts[0] === 'api' && pathParts[1] === 'repos' && pathParts[3] === 'stash' && pathParts[4] === 'drop') {
    command = 'stash_drop';
    args.repo = decodeURIComponent(pathParts[2]);
    if (queryParams.ref) args.stash_ref = queryParams.ref;
  }
  else {
    throw new Error(`Unknown API path: ${path}`);
  }

  return { command, args };
}

/**
 * Invoke a Tauri command
 * @param {string} command - Tauri command name
 * @param {Object} args - Command arguments
 * @returns {Promise<any>} Command result
 */
async function invokeTauriCommand(command, args) {
  try {
    // Tauri 2.0 automatically injects the API into window.__TAURI__
    // In dev mode, it might be in __TAURI_INTERNALS__
    // Wait a bit for Tauri to inject the API if it's not immediately available
    let tauri = window.__TAURI__ || window.__TAURI_INTERNALS__;
    if (!tauri) {
      // In dev mode, Tauri might inject the API slightly later
      console.log('[API] Tauri API not immediately available, waiting 100ms...');
      await new Promise(resolve => setTimeout(resolve, 100));
      tauri = window.__TAURI__ || window.__TAURI_INTERNALS__;
    }

    if (!tauri) {
      console.error('[API] Tauri API not available after wait.');
      console.error('[API] window.__TAURI__:', window.__TAURI__);
      console.error('[API] window.__TAURI_INTERNALS__:', window.__TAURI_INTERNALS__);
      console.error('[API] window.location.protocol:', window.location?.protocol);
      throw new Error('Tauri API not available. Make sure you are running in a Tauri application (not a regular browser).');
    }

    // Log the structure to understand what's available
    console.log('[API] Tauri object keys:', Object.keys(tauri));
    console.log('[API] Tauri object structure:', tauri);

    // Tauri 2.0 invoke: try different ways to access invoke
    // In Tauri 2.0, the API structure might vary, so try multiple paths
    let invokeFn = null;

    // Try standard Tauri 2.0 path
    if (tauri.core && tauri.core.invoke) {
      invokeFn = tauri.core.invoke.bind(tauri.core);
      console.log('[API] Using tauri.core.invoke');
    }
    // Try direct invoke
    else if (tauri.invoke) {
      invokeFn = tauri.invoke.bind(tauri);
      console.log('[API] Using tauri.invoke');
    }
    // Try __TAURI_INTERNALS__ directly with different paths
    else if (window.__TAURI_INTERNALS__) {
      const internals = window.__TAURI_INTERNALS__;
      if (internals.core && internals.core.invoke) {
        invokeFn = internals.core.invoke.bind(internals.core);
        console.log('[API] Using __TAURI_INTERNALS__.core.invoke');
      } else if (internals.invoke) {
        invokeFn = internals.invoke.bind(internals);
        console.log('[API] Using __TAURI_INTERNALS__.invoke');
      } else if (internals.ipc && internals.ipc.invoke) {
        invokeFn = internals.ipc.invoke.bind(internals.ipc);
        console.log('[API] Using __TAURI_INTERNALS__.ipc.invoke');
      }
    }

    if (!invokeFn) {
      console.error('[API] Tauri invoke not available. tauri object keys:', Object.keys(tauri));
      if (window.__TAURI_INTERNALS__) {
        console.error('[API] __TAURI_INTERNALS__ keys:', Object.keys(window.__TAURI_INTERNALS__));
        const internals = window.__TAURI_INTERNALS__;
        Object.keys(internals).forEach(key => {
          if (typeof internals[key] === 'object' && internals[key] !== null) {
            console.error(`[API] __TAURI_INTERNALS__.${key} keys:`, Object.keys(internals[key]));
          }
        });
      }
      throw new Error('Tauri invoke API not available. Check console for available API structure.');
    }

    // Tauri 2.0 invoke: handle args correctly
    // For get_repos, always pass the params object (even if repos_root is null)
    // For commands with no parameters, pass undefined
    let invokeArgs = args;

    if (Object.keys(args).length === 0) {
      if (command === 'browse_projects_root') {
        // browse_projects_root has no parameters
        invokeArgs = undefined;
      } else {
        // Other commands might need empty object
        invokeArgs = undefined;
      }
    }

    console.log(`[API] Invoking Tauri command: ${command}`, invokeArgs !== undefined ? `with args: ${JSON.stringify(invokeArgs)}` : 'with no args');
    if (command === 'get_commit_files') {
      console.log(`[API] get_commit_files - args:`, args);
    }
    const result = await invokeFn(command, invokeArgs);
    console.log(`[API] Command ${command} result:`, result);

    // Handle binary file responses (base64-encoded)
    if (command === 'get_file' && typeof result === 'string') {
      // Decode base64 to text
      try {
        const binaryString = atob(result);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        // Try to decode as UTF-8 text
        return new TextDecoder('utf-8').decode(bytes);
      } catch {
        // If decoding fails, return as-is (might be binary)
        return result;
      }
    }

    return result;
  } catch (error) {
    // Tauri errors can be strings or Error objects
    const errorMessage = error?.message || error?.toString() || String(error) || 'Unknown error';
    throw new Error(errorMessage);
  }
}

// ============================================================================
// Export to window for global access
// ============================================================================

window.api = api;
