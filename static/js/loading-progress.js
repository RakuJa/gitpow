/**
 * Loading Progress Module
 * Manages the splash screen loading indicator with stage updates and progress counts
 */

const loadingProgress = {
  stageEl: null,
  progressEl: null,
  splashEl: null,
  progressFillEl: null,

  /**
   * Initialize the loading progress system
   */
  init() {
    this.stageEl = document.getElementById("loadingStage");
    this.progressEl = document.getElementById("loadingElapsed");
    this.splashEl = document.getElementById("splashScreen");
    this.progressFillEl = document.getElementById("loadingProgressFill");
    // Start with indeterminate animation
    if (this.progressFillEl) {
      this.progressFillEl.classList.add("indeterminate");
    }
  },

  /**
   * Update the loading stage text
   * @param {string} stage - The current loading stage description
   * @param {boolean} clearProgress - Whether to clear the progress text (default: false)
   */
  setStage(stage, clearProgress = false) {
    if (this.stageEl) {
      this.stageEl.textContent = stage;
    }
    // Only clear progress if explicitly requested
    if (clearProgress && this.progressEl) {
      this.progressEl.textContent = "";
    }
    // Also update the floating status message for consistency
    if (typeof setStatusMessage === "function") {
      setStatusMessage(stage);
    }
  },

  /**
   * Update the progress count display and progress bar
   * @param {number} current - Current count
   * @param {number} total - Total count
   * @param {string} label - Label for the items (e.g., "branches", "commits")
   */
  setProgress(current, total, label) {
    const text = `${current.toLocaleString()} / ${total.toLocaleString()} ${label}`;
    if (this.progressEl) {
      this.progressEl.textContent = text;
    }
    // Update progress bar to determinate mode with actual percentage
    if (this.progressFillEl && total > 0) {
      this.progressFillEl.classList.remove("indeterminate");
      const percent = Math.min(100, (current / total) * 100);
      this.progressFillEl.style.width = `${percent}%`;
    }
  },

  /**
   * Set progress bar to indeterminate mode (animated)
   */
  setIndeterminate() {
    if (this.progressFillEl) {
      this.progressFillEl.classList.add("indeterminate");
      this.progressFillEl.style.width = "";
    }
  },

  /**
   * Hide the splash screen and clean up
   */
  hide() {
    if (this.splashEl) {
      this.splashEl.classList.add("hidden");
      // Remove from DOM after transition
      setTimeout(() => {
        if (this.splashEl && this.splashEl.parentNode) {
          this.splashEl.parentNode.removeChild(this.splashEl);
        }
      }, 300);
    }

    // Clear the floating status message
    if (typeof setStatusMessage === "function") {
      setStatusMessage("");
    }
  },

  /**
   * Check if splash screen is still visible
   * @returns {boolean}
   */
  isVisible() {
    return this.splashEl && !this.splashEl.classList.contains("hidden");
  }
};

// Initialize immediately since this script is loaded at the end of body
// DOM elements should already be available
loadingProgress.init();

// Export to window for global access
window.loadingProgress = loadingProgress;
