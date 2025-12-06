/**
 * Conflict Resolution Module for GitPow
 * Handles git merge conflict detection and resolution
 * Extracted from script.js for better maintainability
 */

// ============================================================================
// Conflict Detection and Management
// ============================================================================

/**
 * Check for conflicts in the current repository
 */
async function checkConflicts() {
  if (!state.currentRepo) return;
  try {
    const conflicts = await api("/api/repos/" + encodeURIComponent(state.currentRepo) + "/conflicts");
    state.conflicts = conflicts;
    if (conflicts.hasConflicts) {
      conflictCenter.classList.add("active");
      renderConflictFiles();
    } else {
      conflictCenter.classList.remove("active");
    }
  } catch (e) {
    // Ignore errors, conflicts might not be applicable
  }
}

/**
 * Render the list of conflict files
 */
function renderConflictFiles() {
  conflictFilesList.innerHTML = "";
  state.conflicts.files.forEach(file => {
    const btn = document.createElement("button");
    btn.className = "conflict-file-btn" + (state.currentConflictFile === file.path ? " active" : "");
    btn.textContent = file.path;
    btn.addEventListener("click", () => loadConflictFile(file.path));
    conflictFilesList.appendChild(btn);
  });
  updateConflictProgress();
}

/**
 * Load a specific conflict file for resolution
 * @param {string} filePath - Path to the conflict file
 */
async function loadConflictFile(filePath) {
  state.currentConflictFile = filePath;
  setStatus("Loading conflict data...");
  try {
    const data = await api("/api/repos/" + encodeURIComponent(state.currentRepo) + "/conflicts/file?path=" + encodeURIComponent(filePath));
    state.conflictData = data;
    conflictTheirs.textContent = data.theirs || "(empty)";
    conflictMine.textContent = data.mine || "(empty)";
    conflictBase.textContent = data.base || "(empty)";
    conflictResult.value = data.result || "";
    renderConflictButtons(data.result || "");
    renderConflictFiles();
    setStatus("");
  } catch (e) {
    setStatus(e.message, true);
  }
}

/**
 * Render conflict resolution buttons based on content
 * @param {string} content - The current content of the result area
 */
function renderConflictButtons(content) {
  if (!content) content = "";
  conflictButtons.innerHTML = "";
  // Parse conflict markers - improved regex to handle various formats
  const conflictRegex = /<<<<<<<[^\n]*\n(.*?)\n=======\n(.*?)\n>>>>>>>[^\n]*/gs;
  const matches = [];
  let match;
  while ((match = conflictRegex.exec(content)) !== null) {
    matches.push({
      fullMatch: match[0],
      mineBlock: match[1],
      theirsBlock: match[2],
      index: match.index
    });
  }

  matches.forEach((conflict, idx) => {
    const btnMine = document.createElement("button");
    btnMine.className = "conflict-resolve-btn";
    btnMine.textContent = `Use Mine (${idx + 1})`;
    btnMine.addEventListener("click", () => resolveConflict(idx, "mine", matches));
    const btnTheirs = document.createElement("button");
    btnTheirs.className = "conflict-resolve-btn";
    btnTheirs.textContent = `Use Theirs (${idx + 1})`;
    btnTheirs.addEventListener("click", () => resolveConflict(idx, "theirs", matches));
    const btnBoth = document.createElement("button");
    btnBoth.className = "conflict-resolve-btn";
    btnBoth.textContent = `Use Both (${idx + 1})`;
    btnBoth.addEventListener("click", () => resolveConflict(idx, "both", matches));
    conflictButtons.appendChild(btnMine);
    conflictButtons.appendChild(btnTheirs);
    conflictButtons.appendChild(btnBoth);
  });

  if (matches.length === 0) {
    // No conflicts in result, show resolve button
    const btnResolve = document.createElement("button");
    btnResolve.className = "conflict-resolve-btn";
    btnResolve.textContent = "Mark Resolved";
    btnResolve.addEventListener("click", () => saveConflictResolution());
    conflictButtons.appendChild(btnResolve);
  }
}

/**
 * Resolve a specific conflict with the chosen resolution
 * @param {number} index - Index of the conflict to resolve
 * @param {string} choice - Resolution choice: "mine", "theirs", or "both"
 * @param {Array} matches - Array of conflict matches
 */
function resolveConflict(index, choice, matches) {
  if (!matches) {
    // Re-parse if matches not provided
    const content = conflictResult.value || "";
    const conflictRegex = /<<<<<<<[^\n]*\n(.*?)\n=======\n(.*?)\n>>>>>>>[^\n]*/gs;
    matches = [];
    let match;
    while ((match = conflictRegex.exec(content)) !== null) {
      matches.push({
        fullMatch: match[0],
        mineBlock: match[1],
        theirsBlock: match[2],
        index: match.index
      });
    }
  }

  if (index >= matches.length) return;
  const conflict = matches[index];
  let replacement = "";
  if (choice === "mine") {
    replacement = conflict.mineBlock;
  } else if (choice === "theirs") {
    replacement = conflict.theirsBlock;
  } else if (choice === "both") {
    replacement = conflict.mineBlock + "\n" + conflict.theirsBlock;
  }
  const content = conflictResult.value || "";
  const newContent = content.substring(0, conflict.index) + replacement + content.substring(conflict.index + conflict.fullMatch.length);
  conflictResult.value = newContent;
  renderConflictButtons(newContent);
}

/**
 * Save the conflict resolution
 */
async function saveConflictResolution() {
  if (!state.currentConflictFile || !state.currentRepo) return;
  setStatus("Resolving conflict...");
  try {
    await api("/api/repos/" + encodeURIComponent(state.currentRepo) + "/conflicts/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: state.currentConflictFile, content: conflictResult.value })
    });
    await checkConflicts();
    // Load status if in Activity view (commit canvas is shown in Activity view)
    if (!isGraphMode()) {
      await loadStatus();
    }
    await loadCommits();
    setStatus("Conflict resolved");
  } catch (e) {
    setStatus(e.message, true);
  }
}

/**
 * Update the conflict progress display
 */
function updateConflictProgress() {
  // Count resolved files (files that are no longer in conflicts list after staging)
  // For now, just show total
  const total = state.conflicts.files.length;
  conflictProgress.textContent = `${total} file${total !== 1 ? "s" : ""} with conflicts`;
}

// ============================================================================
// Event Listeners
// ============================================================================

// Set up conflict result input listener
if (conflictResult) {
  conflictResult.addEventListener("input", () => {
    renderConflictButtons(conflictResult.value);
  });
}

// ============================================================================
// Export to window for global access
// ============================================================================

window.checkConflicts = checkConflicts;
window.renderConflictFiles = renderConflictFiles;
window.loadConflictFile = loadConflictFile;
window.renderConflictButtons = renderConflictButtons;
window.resolveConflict = resolveConflict;
window.saveConflictResolution = saveConflictResolution;
window.updateConflictProgress = updateConflictProgress;
