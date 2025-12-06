/**
 * Resize Handles Module for GitPow
 * Panel resizing functionality for the 3-panel layout
 * Extracted from script.js for better maintainability
 */

// ============================================================================
// Resize Handle Position Management
// ============================================================================

/**
 * Update resize handle positions based on current panel widths
 */
function updateResizeHandlePositions() {
  const layout = document.querySelector(".layout");
  if (!layout) return;

  const resizeHandle1 = document.getElementById("resizeHandle1");
  const resizeHandle2 = document.getElementById("resizeHandle2");
  const resizeHandle3 = document.getElementById("resizeHandle3");
  const panels = layout.querySelectorAll(".panel");

  let x = 0;
  if (panels.length >= 1 && resizeHandle1) {
    x += panels[0].offsetWidth;
    resizeHandle1.style.left = x + "px";
  }
  if (panels.length >= 2 && resizeHandle2) {
    if (panels.length === 2) {
      // No third pane; keep handle2 at the right edge for safety
      x = panels[0].offsetWidth;
    } else {
      x = panels[0].offsetWidth + panels[1].offsetWidth;
    }
    resizeHandle2.style.left = x + "px";
  }
  if (panels.length >= 3 && resizeHandle3) {
    x = panels[0].offsetWidth + panels[1].offsetWidth + panels[2].offsetWidth;
    resizeHandle3.style.left = x + "px";
  }
}

// ============================================================================
// Resize Handle Initialization
// ============================================================================

/**
 * Initialize pane resizing functionality
 */
function initResizeHandles() {
  const layout = document.querySelector(".layout");
  const resizeHandle1 = document.getElementById("resizeHandle1");
  const resizeHandle2 = document.getElementById("resizeHandle2");
  const resizeHandle3 = document.getElementById("resizeHandle3");

  // Load saved widths from localStorage
  const savedCol1 = localStorage.getItem("gitzada:col1-width");
  const savedCol2 = localStorage.getItem("gitzada:col2-width");
  const savedCol3 = localStorage.getItem("gitzada:col3-width");
  const savedCol4 = localStorage.getItem("gitzada:col4-width");

  if (savedCol1) layout.style.setProperty("--col1-width", savedCol1);
  if (savedCol2) layout.style.setProperty("--col2-width", savedCol2);
  if (savedCol3) layout.style.setProperty("--col3-width", savedCol3);
  if (savedCol4) layout.style.setProperty("--col4-width", savedCol4);

  function setupResize(handle, colIndex) {
    if (!handle) return;

    let isResizing = false;
    let startX = 0;
    let startCol1Width = 0;
    let startCol2Width = 0;
    let startCol3Width = 0;
    let startCol4Width = 0;

    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      isResizing = true;
      startX = e.clientX;
      handle.classList.add("active");

      // Prevent text selection during resize
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      // Get actual rendered panel widths (more reliable than CSS variables)
      const panels = layout.querySelectorAll(".panel");

      if (colIndex === 1 && panels.length >= 1) {
        startCol1Width = panels[0].offsetWidth;
      } else if (colIndex === 2 && panels.length >= 2) {
        startCol1Width = panels[0].offsetWidth;
        startCol2Width = panels[1].offsetWidth;
        startCol3Width = panels[2] ? panels[2].offsetWidth : 0;
      } else if (colIndex === 3 && panels.length >= 3) {
        startCol1Width = panels[0].offsetWidth;
        startCol2Width = panels[1].offsetWidth;
        startCol3Width = panels[2].offsetWidth;
        startCol4Width = panels[3] ? panels[3].offsetWidth : 0;
      } else {
        // Fallback to CSS variables if panels aren't available
        const computedStyle = getComputedStyle(layout);
        const col1Value = computedStyle.getPropertyValue("--col1-width");
        startCol1Width = col1Value ? parseFloat(col1Value) : 320;

        const totalWidth = layout.offsetWidth;
        const col1Actual = startCol1Width;
        const col4Actual = layout.classList.contains("with-canvas")
          ? (parseFloat(computedStyle.getPropertyValue("--col4-width")) || 400)
          : 0;
        const remainingWidth = totalWidth - col1Actual - col4Actual;

        const col2Value = computedStyle.getPropertyValue("--col2-width");
        const col3Value = computedStyle.getPropertyValue("--col3-width");

        if (col2Value && col2Value.includes("fr")) {
          const col2Fr = parseFloat(col2Value) || 50;
          const col3Fr = parseFloat(col3Value) || 50;
          const totalFr = col2Fr + col3Fr;
          startCol2Width = remainingWidth * (col2Fr / totalFr);
          startCol3Width = remainingWidth * (col3Fr / totalFr);
        } else {
          startCol2Width = remainingWidth * 0.5;
          startCol3Width = remainingWidth * 0.5;
        }

        const col4Value = computedStyle.getPropertyValue("--col4-width");
        startCol4Width = col4Value ? parseFloat(col4Value) : 400;
      }
    });

    const handleMouseMove = (e) => {
      if (!isResizing) return;

      e.preventDefault();
      const diff = e.clientX - startX;
      const totalWidth = layout.offsetWidth;


      if (colIndex === 1) {
        // Resizing between col1 and col2
        const newCol1Width = Math.max(200, Math.min(600, startCol1Width + diff));
        const remainingWidth = totalWidth - newCol1Width;

        // Keep the ratio of col2 to col3, but use fr units for proper grid behavior
        const col2Ratio = startCol2Width / (startCol2Width + startCol3Width);
        const col3Ratio = 1 - col2Ratio;

        // Use fr units based on the ratio
        const col2Fr = col2Ratio * 100;
        const col3Fr = col3Ratio * 100;

        layout.style.setProperty("--col1-width", newCol1Width + "px");
        layout.style.setProperty("--col2-width", col2Fr + "fr");
        layout.style.setProperty("--col3-width", col3Fr + "fr");

        // Update handle positions
        updateResizeHandlePositions();
      } else if (colIndex === 2) {
        // Resizing between col2 (Commits) and col3 (Files)
        const col1Width = parseFloat(getComputedStyle(layout).getPropertyValue("--col1-width")) || 320;
        const col4Width = layout.classList.contains("with-canvas")
          ? (parseFloat(getComputedStyle(layout).getPropertyValue("--col4-width")) || 400)
          : 0;
        const availableWidth = totalWidth - col1Width - col4Width;

        const newCol2Width = Math.max(availableWidth * 0.2, Math.min(availableWidth * 0.8, startCol2Width + diff));
        const newCol3Width = availableWidth - newCol2Width;

        if (newCol3Width >= availableWidth * 0.2) {
          // Calculate ratio for fr units
          const col2Ratio = newCol2Width / availableWidth;
          const col3Ratio = newCol3Width / availableWidth;

          // Use fr units based on the ratio
          const col2Fr = col2Ratio * 100;
          const col3Fr = col3Ratio * 100;

          layout.style.setProperty("--col2-width", col2Fr + "fr");
          layout.style.setProperty("--col3-width", col3Fr + "fr");

          // Update handle position immediately
          updateResizeHandlePositions();
        }
      } else if (colIndex === 3) {
        // Resizing between col3 and col4 (when canvas is open)
        const col1Width = parseFloat(getComputedStyle(layout).getPropertyValue("--col1-width")) || 320;
        const col2Computed = getComputedStyle(layout).getPropertyValue("--col2-width");
        const col3Computed = getComputedStyle(layout).getPropertyValue("--col3-width");

        let col2Width = 0;
        let col3Width = 0;
        const remainingAfterCol1 = totalWidth - col1Width;

        if (col2Computed.includes("fr")) {
          const col2Fr = parseFloat(col2Computed) || 50;
          const col3Fr = parseFloat(col3Computed) || 50;
          const totalFr = col2Fr + col3Fr;
          col2Width = remainingAfterCol1 * (col2Fr / totalFr);
          col3Width = remainingAfterCol1 * (col3Fr / totalFr);
        } else if (col2Computed.includes("%")) {
          col2Width = remainingAfterCol1 * (parseFloat(col2Computed) / 100);
          col3Width = remainingAfterCol1 * (parseFloat(col3Computed) / 100);
        } else {
          col2Width = parseFloat(col2Computed) || remainingAfterCol1 * 0.5;
          col3Width = parseFloat(col3Computed) || remainingAfterCol1 * 0.5;
        }

        const availableWidth = totalWidth - col1Width - col2Width;
        const newCol3Width = Math.max(availableWidth * 0.2, Math.min(availableWidth * 0.8, startCol3Width + diff));
        const newCol4Width = Math.max(200, startCol4Width - diff);

        if (newCol3Width >= availableWidth * 0.2 && newCol4Width >= 200) {
          // Convert col3 to fr units based on ratio
          const col3Fr = (newCol3Width / availableWidth) * 100;
          const col2Fr = (col2Width / remainingAfterCol1) * 100;
          layout.style.setProperty("--col2-width", col2Fr + "fr");
          layout.style.setProperty("--col3-width", col3Fr + "fr");
          layout.style.setProperty("--col4-width", newCol4Width + "px");

          // Update handle positions
          updateResizeHandlePositions();
        }
      }
    };

    const handleMouseUp = (e) => {
      if (isResizing) {
        isResizing = false;
        handle.classList.remove("active");

        // Restore text selection and cursor
        document.body.style.userSelect = "";
        document.body.style.cursor = "";

        // Save to localStorage
        const computedStyle = getComputedStyle(layout);
        localStorage.setItem("gitzada:col1-width", computedStyle.getPropertyValue("--col1-width"));
        localStorage.setItem("gitzada:col2-width", computedStyle.getPropertyValue("--col2-width"));
        localStorage.setItem("gitzada:col3-width", computedStyle.getPropertyValue("--col3-width"));
        if (layout.classList.contains("with-canvas")) {
          localStorage.setItem("gitzada:col4-width", computedStyle.getPropertyValue("--col4-width"));
        }
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  if (resizeHandle1) setupResize(resizeHandle1, 1);
  if (resizeHandle2) setupResize(resizeHandle2, 2);
  if (resizeHandle3) setupResize(resizeHandle3, 3);

  // Update handle positions after setup
  setTimeout(() => {
    updateResizeHandlePositions();
  }, 100);
}

// ============================================================================
// Event Listeners
// ============================================================================

// Initialize resize handles after DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initResizeHandles);
} else {
  initResizeHandles();
}

// Also update handle positions when window resizes
window.addEventListener("resize", () => {
  updateResizeHandlePositions();
});

// ============================================================================
// Export to window for global access
// ============================================================================

window.updateResizeHandlePositions = updateResizeHandlePositions;
window.initResizeHandles = initResizeHandles;
