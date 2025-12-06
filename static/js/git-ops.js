/**
 * Git Operations Module for GitPow
 * Handles Fetch, Pull, Push, and Stash operations
 * Extracted for better maintainability
 */

// ============================================================================
// DOM Elements
// ============================================================================

const gitFetchBtn = document.getElementById("gitFetchBtn");
const gitPullBtn = document.getElementById("gitPullBtn");
const gitPushBtn = document.getElementById("gitPushBtn");
const gitStashBtn = document.getElementById("gitStashBtn");
const gitStashPopBtn = document.getElementById("gitStashPopBtn");
const pullBadge = document.getElementById("pullBadge");
const pushBadge = document.getElementById("pushBadge");
const stashBadge = document.getElementById("stashBadge");
const gitOpsBranch = document.getElementById("gitOpsBranch");
const gitOpsSync = document.getElementById("gitOpsSync");
const gitOpsStatusMessage = document.getElementById("gitOpsStatusMessage");

// ============================================================================
// State
// ============================================================================

let branchStatusCache = null;
let branchStatusLastFetch = 0;
const BRANCH_STATUS_CACHE_TTL = 10000; // 10 seconds

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Show a status message in the git ops toolbar
 * @param {string} message - Message to display
 * @param {string} type - 'info', 'success', or 'error'
 * @param {number} duration - Auto-clear after ms (0 = no auto-clear)
 */
function setGitOpsStatus(message, type = "info", duration = 5000) {
  if (!gitOpsStatusMessage) return;

  gitOpsStatusMessage.textContent = message;
  gitOpsStatusMessage.className = "git-ops-status-message";
  if (type === "error") {
    gitOpsStatusMessage.classList.add("error");
  } else if (type === "success") {
    gitOpsStatusMessage.classList.add("success");
  }

  if (duration > 0) {
    setTimeout(() => {
      if (gitOpsStatusMessage.textContent === message) {
        gitOpsStatusMessage.textContent = "";
        gitOpsStatusMessage.className = "git-ops-status-message";
      }
    }, duration);
  }
}

/**
 * Set a button to loading state
 * @param {HTMLElement} btn - Button element
 * @param {boolean} loading - Whether loading
 */
function setButtonLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.classList.add("loading");
    btn.disabled = true;
  } else {
    btn.classList.remove("loading");
    btn.disabled = false;
  }
}

/**
 * Update badge visibility and count
 * @param {HTMLElement} badge - Badge element
 * @param {number} count - Count to display
 */
function updateBadge(badge, count) {
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : count.toString();
    badge.style.display = "inline-flex";
  } else {
    badge.style.display = "none";
  }
}

// ============================================================================
// Branch Status
// ============================================================================

/**
 * Fetch branch status from the server
 * @param {boolean} force - Force refresh even if cached
 */
async function fetchBranchStatus(force = false) {
  if (!state.currentRepo) {
    updateBranchStatusUI(null);
    return null;
  }

  const now = Date.now();
  if (!force && branchStatusCache && (now - branchStatusLastFetch) < BRANCH_STATUS_CACHE_TTL) {
    return branchStatusCache;
  }

  try {
    const status = await api(`/api/repos/${encodeURIComponent(state.currentRepo)}/branch-status`);
    branchStatusCache = status;
    branchStatusLastFetch = now;
    updateBranchStatusUI(status);
    return status;
  } catch (e) {
    console.error("Failed to fetch branch status:", e);
    updateBranchStatusUI(null);
    return null;
  }
}

/**
 * Update the UI with branch status information
 * @param {Object|null} status - Branch status object
 */
function updateBranchStatusUI(status) {
  if (!status) {
    if (gitOpsBranch) gitOpsBranch.textContent = "--";
    if (gitOpsSync) {
      gitOpsSync.textContent = "";
      gitOpsSync.className = "git-ops-sync";
    }
    updateBadge(pullBadge, 0);
    updateBadge(pushBadge, 0);
    updateBadge(stashBadge, 0);
    return;
  }

  // Update branch name
  if (gitOpsBranch) {
    gitOpsBranch.textContent = status.branch || "--";
  }

  // Update sync status
  if (gitOpsSync) {
    const { ahead, behind, has_upstream } = status;
    if (!has_upstream) {
      gitOpsSync.textContent = "no upstream";
      gitOpsSync.className = "git-ops-sync";
    } else if (ahead > 0 && behind > 0) {
      gitOpsSync.textContent = `↑${ahead} ↓${behind}`;
      gitOpsSync.className = "git-ops-sync diverged";
    } else if (ahead > 0) {
      gitOpsSync.textContent = `↑${ahead} ahead`;
      gitOpsSync.className = "git-ops-sync ahead";
    } else if (behind > 0) {
      gitOpsSync.textContent = `↓${behind} behind`;
      gitOpsSync.className = "git-ops-sync behind";
    } else {
      gitOpsSync.textContent = "up to date";
      gitOpsSync.className = "git-ops-sync";
    }
  }

  // Update badges
  updateBadge(pullBadge, status.behind || 0);
  updateBadge(pushBadge, status.ahead || 0);
  updateBadge(stashBadge, status.stash_count || 0);
}

// ============================================================================
// Git Operations
// ============================================================================

/**
 * Perform git fetch
 */
async function doGitFetch() {
  if (!state.currentRepo) {
    setGitOpsStatus("Select a repository first", "error");
    return;
  }

  setButtonLoading(gitFetchBtn, true);
  setGitOpsStatus("Fetching...", "info", 0);

  try {
    await api(`/api/repos/${encodeURIComponent(state.currentRepo)}/fetch`, {
      method: "POST",
    });

    setGitOpsStatus("Fetch complete", "success");

    // Invalidate caches and reload
    loadedCommitsKey = null;
    cachedAllBranchesCommits = null;
    cachedAllBranchesKey = null;
    branchStatusCache = null;

    await Promise.all([
      loadCommits(),
      fetchBranchStatus(true)
    ]);
  } catch (e) {
    setGitOpsStatus(e.message || "Fetch failed", "error");
  } finally {
    setButtonLoading(gitFetchBtn, false);
  }
}

/**
 * Perform git pull
 */
async function doGitPull() {
  if (!state.currentRepo) {
    setGitOpsStatus("Select a repository first", "error");
    return;
  }

  setButtonLoading(gitPullBtn, true);
  setGitOpsStatus("Pulling...", "info", 0);

  try {
    const result = await api(`/api/repos/${encodeURIComponent(state.currentRepo)}/pull`, {
      method: "POST",
    });

    if (result.success) {
      setGitOpsStatus(result.message || "Pull complete", "success");

      // Invalidate caches and reload
      loadedCommitsKey = null;
      cachedAllBranchesCommits = null;
      cachedAllBranchesKey = null;
      branchStatusCache = null;

      await Promise.all([
        loadCommits(),
        loadStatus(),
        fetchBranchStatus(true)
      ]);
    } else {
      setGitOpsStatus(result.error || result.message || "Pull failed", "error");
    }
  } catch (e) {
    setGitOpsStatus(e.message || "Pull failed", "error");
  } finally {
    setButtonLoading(gitPullBtn, false);
  }
}

/**
 * Perform git push
 */
async function doGitPush() {
  if (!state.currentRepo) {
    setGitOpsStatus("Select a repository first", "error");
    return;
  }

  setButtonLoading(gitPushBtn, true);
  setGitOpsStatus("Pushing...", "info", 0);

  try {
    const result = await api(`/api/repos/${encodeURIComponent(state.currentRepo)}/push`, {
      method: "POST",
    });

    if (result.success) {
      setGitOpsStatus(result.message || "Push complete", "success");

      // Refresh branch status
      branchStatusCache = null;
      await fetchBranchStatus(true);
    } else {
      setGitOpsStatus(result.error || result.message || "Push failed", "error");
    }
  } catch (e) {
    setGitOpsStatus(e.message || "Push failed", "error");
  } finally {
    setButtonLoading(gitPushBtn, false);
  }
}

/**
 * Stash current changes
 */
async function doGitStash() {
  if (!state.currentRepo) {
    setGitOpsStatus("Select a repository first", "error");
    return;
  }

  setButtonLoading(gitStashBtn, true);
  setGitOpsStatus("Stashing...", "info", 0);

  try {
    const result = await api(`/api/repos/${encodeURIComponent(state.currentRepo)}/stash/push`, {
      method: "POST",
    });

    if (result.success) {
      setGitOpsStatus(result.message || "Changes stashed", "success");

      // Refresh status and branch status
      branchStatusCache = null;
      await Promise.all([
        loadStatus(),
        fetchBranchStatus(true)
      ]);
    } else {
      setGitOpsStatus(result.error || result.message || "Stash failed", "error");
    }
  } catch (e) {
    setGitOpsStatus(e.message || "Stash failed", "error");
  } finally {
    setButtonLoading(gitStashBtn, false);
  }
}

/**
 * Pop the most recent stash
 */
async function doGitStashPop() {
  if (!state.currentRepo) {
    setGitOpsStatus("Select a repository first", "error");
    return;
  }

  setButtonLoading(gitStashPopBtn, true);
  setGitOpsStatus("Popping stash...", "info", 0);

  try {
    const result = await api(`/api/repos/${encodeURIComponent(state.currentRepo)}/stash/pop`, {
      method: "POST",
    });

    if (result.success) {
      setGitOpsStatus(result.message || "Stash popped", "success");

      // Refresh status and branch status
      branchStatusCache = null;
      await Promise.all([
        loadStatus(),
        fetchBranchStatus(true)
      ]);
    } else {
      setGitOpsStatus(result.error || result.message || "Pop failed", "error");
    }
  } catch (e) {
    setGitOpsStatus(e.message || "Pop failed", "error");
  } finally {
    setButtonLoading(gitStashPopBtn, false);
  }
}

// ============================================================================
// Event Listeners
// ============================================================================

if (gitFetchBtn) {
  gitFetchBtn.addEventListener("click", doGitFetch);
}

if (gitPullBtn) {
  gitPullBtn.addEventListener("click", doGitPull);
}

if (gitPushBtn) {
  gitPushBtn.addEventListener("click", doGitPush);
}

if (gitStashBtn) {
  gitStashBtn.addEventListener("click", doGitStash);
}

if (gitStashPopBtn) {
  gitStashPopBtn.addEventListener("click", doGitStashPop);
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the git ops toolbar
 * Called when a repo is selected or changed
 */
function initGitOps() {
  branchStatusCache = null;
  branchStatusLastFetch = 0;
  fetchBranchStatus(true);
}

// ============================================================================
// Export to window for global access
// ============================================================================

window.fetchBranchStatus = fetchBranchStatus;
window.initGitOps = initGitOps;
window.setGitOpsStatus = setGitOpsStatus;
window.doGitFetch = doGitFetch;
window.doGitPull = doGitPull;
window.doGitPush = doGitPush;
window.doGitStash = doGitStash;
window.doGitStashPop = doGitStashPop;
