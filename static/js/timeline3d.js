/**
 * 3D Timeline Visualization Module for GitPow
 * Three.js-based 3D visualization of commit history
 * Extracted from script.js for better maintainability
 */

// ============================================================================
// 3D Scene Initialization
// ============================================================================

/**
 * Initialize the 3D scene, camera, and renderer
 */
async function init3D() {
  const { Scene, PerspectiveCamera, WebGLRenderer, Color, AmbientLight, DirectionalLight, SphereGeometry, MeshStandardMaterial, Mesh, Group, LineBasicMaterial, BufferGeometry, Line, Vector3, Raycaster } = await import("three");
  const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");

  const container = document.getElementById("timeline3d");
  if (!container) return;

  // Scene setup
  state.scene3d = new Scene();
  state.scene3d.background = new Color(0x020617);

  // Camera - use window dimensions if container is hidden
  let width = container.clientWidth;
  let height = container.clientHeight;
  if (width === 0 || height === 0) {
    // Container might be hidden, use parent or window dimensions
    const parent = container.parentElement;
    if (parent) {
      width = parent.clientWidth || window.innerWidth;
      height = parent.clientHeight || window.innerHeight;
    } else {
      width = window.innerWidth;
      height = window.innerHeight;
    }
  }
  state.camera3d = new PerspectiveCamera(75, width / height, 0.1, 1000);
  state.camera3d.position.set(0, 10, 20);

  // Renderer
  state.renderer3d = new WebGLRenderer({ antialias: true });
  state.renderer3d.setSize(width, height);
  state.renderer3d.setPixelRatio(window.devicePixelRatio);
  container.appendChild(state.renderer3d.domElement);

  // Controls
  state.controls3d = new OrbitControls(state.camera3d, state.renderer3d.domElement);
  state.controls3d.enableDamping = true;
  state.controls3d.dampingFactor = 0.05;
  state.controls3d.minDistance = 5;
  state.controls3d.maxDistance = 50;

  // Lighting
  const ambientLight = new AmbientLight(0xffffff, 0.6);
  state.scene3d.add(ambientLight);
  const directionalLight = new DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 10, 5);
  state.scene3d.add(directionalLight);

  // Raycaster for click detection
  state.raycaster3d = new Raycaster();
  state.mouse3d = new Vector3();

  // Click handler for NEO mode - no commit details shown, just status
  state.renderer3d.domElement.addEventListener("click", (event) => {
    if (!state.camera3d || !state.scene3d) return;
    // In NEO mode, clicking doesn't show details - just visual feedback
    const rect = state.renderer3d.domElement.getBoundingClientRect();
    state.mouse3d.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    state.mouse3d.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    state.raycaster3d.setFromCamera(state.mouse3d, state.camera3d);
    const intersects = state.raycaster3d.intersectObjects(state.scene3d.children, true);

    if (intersects.length > 0) {
      const obj = intersects[0].object;
      if (obj.userData && obj.userData.commit) {
        // Just highlight, don't load details
        const commit = obj.userData.commit;
        setStatus(`Commit: ${commit.sha.substring(0, 7)} - ${commit.message.substring(0, 50)}...`);
      }
    }
  });

  // Handle resize
  const resizeObserver = new ResizeObserver(() => {
    if (state.camera3d && state.renderer3d && container) {
      const w = container.clientWidth;
      const h = container.clientHeight;
      state.camera3d.aspect = w / h;
      state.camera3d.updateProjectionMatrix();
      state.renderer3d.setSize(w, h);
    }
  });
  resizeObserver.observe(container);

  // Animation loop
  function animate() {
    requestAnimationFrame(animate);
    if (state.controls3d) state.controls3d.update();
    if (state.renderer3d && state.scene3d && state.camera3d) {
      state.renderer3d.render(state.scene3d, state.camera3d);
    }
  }
  animate();
}

// ============================================================================
// Position Calculation
// ============================================================================

/**
 * Calculate stacked position for a commit
 * @param {Object} commit - Commit object
 * @param {number} index - Index in the commit list
 * @param {number} total - Total number of commits
 * @returns {Object} Position with x, y, z coordinates
 */
function calculateStackedPosition(commit, index, total) {
  // Simple vertical stacking: newer commits on top
  const spacing = 2.0; // Distance between commits
  const z = index * spacing; // Stack vertically
  const x = 0; // Center horizontally
  const y = 0; // Center horizontally

  return { x, y, z };
}

// ============================================================================
// 3D Timeline Rendering
// ============================================================================

/**
 * Render the 3D timeline with commits using InstancedMesh for performance
 */
async function render3DTimeline() {
  // Use commits from state, fallback to filteredCommits
  let commitsToRender = state.commits || state.filteredCommits || [];
  if (!commitsToRender || commitsToRender.length === 0) {
    setStatus("No commits to display. Loading commits...", true);
    // Try to load commits if we don't have any
    if (state.currentRepo && state.currentBranch) {
      await loadCommits();
      commitsToRender = state.commits || state.filteredCommits || [];
    }
    if (!commitsToRender || commitsToRender.length === 0) {
      setStatus("No commits available", true);
      return;
    }
  }

  // Initialize 3D if not already done
  if (!state.scene3d) {
    await init3D();
  }

  if (!state.scene3d) {
    setStatus("Failed to initialize 3D scene", true);
    return;
  }

  // Simple stacked display - no need for metrics or branch angles
  setStatus("Loading commits...");
  let commitsData = optimizeHelixPerformance(commitsToRender);

  const { SphereGeometry, MeshStandardMaterial, InstancedMesh, Object3D, Matrix4, Color, LineBasicMaterial, BufferGeometry, LineSegments, Float32BufferAttribute, Group } = await import("three");

  // Clear existing objects
  state.commitObjects3d.forEach(obj => {
    if (obj.group) state.scene3d.remove(obj.group);
  });
  state.commitObjects3d.clear();

  // Also remove previous instanced meshes and lines
  if (state.instancedMesh) {
    state.scene3d.remove(state.instancedMesh);
    state.instancedMesh.geometry.dispose();
    state.instancedMesh.material.dispose();
  }
  if (state.glowInstancedMesh) {
    state.scene3d.remove(state.glowInstancedMesh);
    state.glowInstancedMesh.geometry.dispose();
    state.glowInstancedMesh.material.dispose();
  }
  if (state.edgeLines) {
    state.scene3d.remove(state.edgeLines);
    state.edgeLines.geometry.dispose();
    state.edgeLines.material.dispose();
  }

  if (!commitsData || commitsData.length === 0) {
    setStatus("No commits data available", true);
    return;
  }

  // Calculate simple stacked positions for all commits
  const positions = new Map();
  commitsData.forEach((commit, index) => {
    const pos = calculateStackedPosition(commit, index, commitsData.length);
    positions.set(commit.sha, pos);
  });

  if (positions.size === 0) {
    setStatus("Failed to calculate commit positions", true);
    return;
  }

  // Helper to compute color value from commit
  function getCommitColor(commit) {
    if (commit.isHead) return 0x22c55e; // green for HEAD
    if (commit.isMerge) return 0xa78bfa; // purple for merges
    if (commit.isMain) return 0x3b82f6; // blue for main branch

    // Color by author or branch
    const hslColor = hashColor(commit.author || commit.sha);
    const match = hslColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (match) {
      const h = parseInt(match[1]) / 360;
      const s = parseInt(match[2]) / 100;
      const l = parseInt(match[3]) / 100;
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs((h * 6) % 2 - 1));
      const m = l - c / 2;
      let r, g, b;
      if (h < 1/6) { r = c; g = x; b = 0; }
      else if (h < 2/6) { r = x; g = c; b = 0; }
      else if (h < 3/6) { r = 0; g = c; b = x; }
      else if (h < 4/6) { r = 0; g = x; b = c; }
      else if (h < 5/6) { r = x; g = 0; b = c; }
      else { r = c; g = 0; b = x; }
      return ((Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255));
    }
    return 0x6b7280; // default gray
  }

  // ========== INSTANCED MESH FOR ALL COMMIT SPHERES ==========
  // Single draw call instead of N draw calls!
  const sphereSize = 0.5;
  const sphereGeometry = new SphereGeometry(sphereSize, 12, 12); // Reduced segments for performance
  const sphereMaterial = new MeshStandardMaterial({
    color: 0xffffff, // Base white, we'll use instance colors
    metalness: 0.1,
    roughness: 0.6
  });

  const instanceCount = commitsData.length;
  const instancedMesh = new InstancedMesh(sphereGeometry, sphereMaterial, instanceCount);
  instancedMesh.instanceMatrix.setUsage(35044); // THREE.DynamicDrawUsage for potential updates

  const dummy = new Object3D();
  const color = new Color();

  // Count glowing commits for glow instanced mesh
  const glowCommits = commitsData.filter(c => c.isHead || c.isMerge);

  // Set up main instances
  commitsData.forEach((commit, i) => {
    const pos = positions.get(commit.sha);
    if (!pos) return;

    dummy.position.set(pos.x, pos.y, pos.z);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    instancedMesh.setMatrixAt(i, dummy.matrix);

    const colorValue = getCommitColor(commit);
    color.setHex(colorValue);
    instancedMesh.setColorAt(i, color);

    // Store commit data for raycasting
    state.commitObjects3d.set(commit.sha, { index: i, commit, pos });
  });

  instancedMesh.instanceMatrix.needsUpdate = true;
  if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
  state.instancedMesh = instancedMesh;
  state.scene3d.add(instancedMesh);

  // ========== GLOW INSTANCED MESH FOR SPECIAL COMMITS ==========
  if (glowCommits.length > 0) {
    const glowGeometry = new SphereGeometry(sphereSize * 1.3, 8, 8);
    const glowMaterial = new MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.3,
      emissive: 0xffffff,
      emissiveIntensity: 0.5
    });

    const glowInstancedMesh = new InstancedMesh(glowGeometry, glowMaterial, glowCommits.length);

    glowCommits.forEach((commit, i) => {
      const pos = positions.get(commit.sha);
      if (!pos) return;

      dummy.position.set(pos.x, pos.y, pos.z);
      dummy.updateMatrix();
      glowInstancedMesh.setMatrixAt(i, dummy.matrix);

      const colorValue = getCommitColor(commit);
      color.setHex(colorValue);
      glowInstancedMesh.setColorAt(i, color);
    });

    glowInstancedMesh.instanceMatrix.needsUpdate = true;
    if (glowInstancedMesh.instanceColor) glowInstancedMesh.instanceColor.needsUpdate = true;
    state.glowInstancedMesh = glowInstancedMesh;
    state.scene3d.add(glowInstancedMesh);
  }

  // ========== MERGED LINE SEGMENTS FOR ALL EDGES ==========
  // Collect all edge vertices into a single geometry
  const edgeVertices = [];
  const edgeColors = [];

  commitsData.forEach(commit => {
    const pos = positions.get(commit.sha);
    if (!pos || !commit.parents) return;

    const lineColorValue = commit.isMain ? 0x3b82f6 : commit.isMerge ? 0xa78bfa : 0x6b7280;
    color.setHex(lineColorValue);

    commit.parents.forEach(parentSha => {
      const parentPos = positions.get(parentSha);
      if (!parentPos) return;

      // Add line segment (2 vertices per edge)
      edgeVertices.push(pos.x, pos.y, pos.z);
      edgeVertices.push(parentPos.x, parentPos.y, parentPos.z);

      // Add colors for both vertices
      edgeColors.push(color.r, color.g, color.b);
      edgeColors.push(color.r, color.g, color.b);
    });
  });

  if (edgeVertices.length > 0) {
    const edgeGeometry = new BufferGeometry();
    edgeGeometry.setAttribute('position', new Float32BufferAttribute(edgeVertices, 3));
    edgeGeometry.setAttribute('color', new Float32BufferAttribute(edgeColors, 3));

    const edgeMaterial = new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5
    });

    const edgeLines = new LineSegments(edgeGeometry, edgeMaterial);
    state.edgeLines = edgeLines;
    state.scene3d.add(edgeLines);
  }

  // Add tags as simple markers
  try {
    const tags = await api("/api/repos/" + encodeURIComponent(state.currentRepo) + "/tags");
    const { RingGeometry, MeshBasicMaterial } = await import("three");

    tags.forEach(tag => {
      const commitPos = positions.get(tag.sha);
      if (!commitPos) return;

      // Create simple ring marker at tag position
      const ringGeometry = new RingGeometry(0.7, 0.8, 32);
      const ringMaterial = new MeshBasicMaterial({
        color: 0xffd700, // gold
        side: 2, // DoubleSide
        transparent: true,
        opacity: 0.8
      });
      const ring = new Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = Math.PI / 2; // Horizontal ring
      ring.position.set(commitPos.x, commitPos.y, commitPos.z);
      ring.userData = { tag };
      state.scene3d.add(ring);
    });
  } catch (e) {
    console.warn("Could not load tags:", e);
  }

  // Center camera on stacked commits
  if (positions.size > 0) {
    // Find center and bounds of stack
    let centerX = 0, centerY = 0, centerZ = 0;
    let minZ = Infinity, maxZ = -Infinity;
    let count = 0;

    positions.forEach(pos => {
      centerX += pos.x;
      centerY += pos.y;
      centerZ += pos.z;
      minZ = Math.min(minZ, pos.z);
      maxZ = Math.max(maxZ, pos.z);
      count++;
    });

    if (count > 0) {
      centerX /= count;
      centerY /= count;
      centerZ = (minZ + maxZ) / 2; // Center on the stack

      // Calculate distance to fit all commits in view
      const stackHeight = maxZ - minZ || 10;
      const distance = Math.max(stackHeight * 1.2, 15);

      if (state.camera3d && state.controls3d) {
        // Position camera to view stack from side
        state.camera3d.position.set(distance, distance * 0.5, distance);
        state.controls3d.target.set(centerX, centerY, centerZ);
        state.controls3d.update();
      }
    }
  }

  setStatus(`NEO: ${commitsData.length} commits stacked`);
}

// ============================================================================
// Camera Presets
// ============================================================================

/**
 * Set camera to a preset position
 * @param {string} preset - Preset name: "top", "side", or "orbit"
 */
function setCameraPreset(preset) {
  if (!state.camera3d || !state.controls3d || !state.scene3d) return;

  // Find center of helix
  let centerX = 0, centerY = 0, centerZ = 0;
  let count = 0;
  state.commitObjects3d.forEach((obj, sha) => {
    if (obj.group && obj.group.children.length > 0) {
      const pos = obj.group.children[0].position;
      centerX += pos.x;
      centerY += pos.y;
      centerZ += pos.z;
      count++;
    }
  });
  if (count > 0) {
    centerX /= count;
    centerY /= count;
    centerZ /= count;
  }

  if (preset === "top") {
    // Top-down view
    state.camera3d.position.set(centerX, centerY + 20, centerZ);
    state.controls3d.target.set(centerX, centerY, centerZ);
  } else if (preset === "side") {
    // Side view
    state.camera3d.position.set(centerX + 15, centerY, centerZ);
    state.controls3d.target.set(centerX, centerY, centerZ);
  } else if (preset === "orbit") {
    // Orbiting view
    state.camera3d.position.set(centerX + 10, centerY + 5, centerZ + 10);
    state.controls3d.target.set(centerX, centerY, centerZ);
  }
  state.controls3d.update();
}

// ============================================================================
// Performance Optimization
// ============================================================================

/**
 * Optimize commits for helix performance (limit visible commits for large repos)
 * @param {Array} commits - Array of commits
 * @returns {Array} Optimized array of commits
 */
function optimizeHelixPerformance(commits) {
  if (commits.length > 500) {
    // For very large repos, show every Nth commit
    const step = Math.ceil(commits.length / 500);
    return commits.filter((c, i) => i % step === 0 || c.isHead || c.isMerge || c.isMain);
  }
  return commits;
}

// ============================================================================
// Event Listeners
// ============================================================================

// Helix interaction controls
const timeRange = document.getElementById("timeRange");
const timeRangeLabel = document.getElementById("timeRangeLabel");
const cameraTop = document.getElementById("cameraTop");
const cameraSide = document.getElementById("cameraSide");
const cameraOrbit = document.getElementById("cameraOrbit");

if (timeRange) {
  timeRange.addEventListener("input", (e) => {
    const value = parseInt(e.target.value);
    if (timeRangeLabel) {
      timeRangeLabel.textContent = value === 100 ? "All" : `${value}%`;
    }
    // Filter commits by time range
    if (isGraphMode() && state.commits) {
      const filteredCount = Math.floor((value / 100) * state.commits.length);
      state.filteredCommits = state.commits.slice(0, Math.max(1, filteredCount));
      render3DTimeline();
    }
  });
}

if (cameraTop) cameraTop.addEventListener("click", () => setCameraPreset("top"));
if (cameraSide) cameraSide.addEventListener("click", () => setCameraPreset("side"));
if (cameraOrbit) cameraOrbit.addEventListener("click", () => setCameraPreset("orbit"));

// ============================================================================
// Export to window for global access
// ============================================================================

window.init3D = init3D;
window.calculateStackedPosition = calculateStackedPosition;
window.render3DTimeline = render3DTimeline;
window.setCameraPreset = setCameraPreset;
window.optimizeHelixPerformance = optimizeHelixPerformance;
