/**
 * IndexedDB Cache Module for GitPow
 * Caches branches and commits data for faster subsequent loads
 */

const gitCache = {
  db: null,
  DB_NAME: "gitpow-cache",
  DB_VERSION: 3,  // Bumped for FILES store
  STORES: {
    REPOS: "repos",      // Store repo metadata (HEAD, refs hash, timestamps)
    BRANCHES: "branches", // Store branches per repo
    COMMITS: "commits",   // Store commits per repo/branch
    DIFFS: "diffs",       // Store file diffs per commit (immutable, never expires)
    FILES: "files"        // Store changed files per commit (immutable, never expires)
  },

  /**
   * Delete the database and reinitialize (use when schema changes require fresh start)
   * @returns {Promise<void>}
   */
  async resetDatabase() {
    console.log("[gitCache] Resetting database...");
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.DB_NAME);
      request.onsuccess = () => {
        console.log("[gitCache] Database deleted, reinitializing...");
        this.init().then(resolve).catch(reject);
      };
      request.onerror = () => {
        console.error("[gitCache] Failed to delete database:", request.error);
        reject(request.error);
      };
    });
  },

  /**
   * Initialize the IndexedDB database
   * @returns {Promise<IDBDatabase>}
   */
  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => {
        console.error("[gitCache] Failed to open IndexedDB:", request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;

        // Check if all required stores exist - if not, we need to reset the database
        const requiredStores = [this.STORES.REPOS, this.STORES.BRANCHES, this.STORES.COMMITS, this.STORES.DIFFS, this.STORES.FILES];
        const missingStores = requiredStores.filter(store => !this.db.objectStoreNames.contains(store));

        if (missingStores.length > 0) {
          console.warn("[gitCache] Missing stores detected:", missingStores, "- resetting database");
          this.db.close();
          this.db = null;
          // Delete and recreate the database
          const deleteRequest = indexedDB.deleteDatabase(this.DB_NAME);
          deleteRequest.onsuccess = () => {
            console.log("[gitCache] Database deleted, reinitializing...");
            // Recursively call init to create fresh database
            this.init().then(resolve).catch(reject);
          };
          deleteRequest.onerror = () => {
            console.error("[gitCache] Failed to delete database for reset");
            reject(deleteRequest.error);
          };
          return;
        }

        console.log("[gitCache] IndexedDB initialized");
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        console.log("[gitCache] Upgrading IndexedDB schema from version", event.oldVersion, "to", event.newVersion);

        // Repos store - tracks repo state for cache invalidation
        if (!db.objectStoreNames.contains(this.STORES.REPOS)) {
          const repoStore = db.createObjectStore(this.STORES.REPOS, { keyPath: "repoId" });
          repoStore.createIndex("lastAccessed", "lastAccessed", { unique: false });
        }

        // Branches store - keyed by repoId
        if (!db.objectStoreNames.contains(this.STORES.BRANCHES)) {
          db.createObjectStore(this.STORES.BRANCHES, { keyPath: "repoId" });
        }

        // Commits store - keyed by repoId:branch:mode
        if (!db.objectStoreNames.contains(this.STORES.COMMITS)) {
          const commitStore = db.createObjectStore(this.STORES.COMMITS, { keyPath: "cacheKey" });
          commitStore.createIndex("repoId", "repoId", { unique: false });
        }

        // Diffs store - keyed by repoId:sha:filePath (immutable, never expires)
        if (!db.objectStoreNames.contains(this.STORES.DIFFS)) {
          const diffStore = db.createObjectStore(this.STORES.DIFFS, { keyPath: "cacheKey" });
          diffStore.createIndex("repoId", "repoId", { unique: false });
        }

        // Files store - keyed by repoId:sha (immutable, never expires)
        if (!db.objectStoreNames.contains(this.STORES.FILES)) {
          const filesStore = db.createObjectStore(this.STORES.FILES, { keyPath: "cacheKey" });
          filesStore.createIndex("repoId", "repoId", { unique: false });
        }
      };
    });
  },

  /**
   * Get repo metadata from cache
   * @param {string} repoId - Repository ID
   * @returns {Promise<Object|null>}
   */
  async getRepoMeta(repoId) {
    await this.init();
    return new Promise((resolve) => {
      const tx = this.db.transaction(this.STORES.REPOS, "readonly");
      const store = tx.objectStore(this.STORES.REPOS);
      const request = store.get(repoId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  },

  /**
   * Save repo metadata
   * @param {string} repoId - Repository ID
   * @param {Object} meta - Metadata (head, refsHash, etc.)
   */
  async saveRepoMeta(repoId, meta) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.STORES.REPOS, "readwrite");
      const store = tx.objectStore(this.STORES.REPOS);
      const request = store.put({
        repoId,
        ...meta,
        lastAccessed: Date.now()
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Get cached branches for a repo
   * @param {string} repoId - Repository ID
   * @returns {Promise<Object|null>} - { branches, branchMetadata, current } or null
   */
  async getBranches(repoId) {
    await this.init();
    return new Promise((resolve) => {
      const tx = this.db.transaction(this.STORES.BRANCHES, "readonly");
      const store = tx.objectStore(this.STORES.BRANCHES);
      const request = store.get(repoId);
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          console.log(`[gitCache] Branches cache hit for ${repoId}: ${result.branches?.length || 0} branches`);
          resolve(result);
        } else {
          console.log(`[gitCache] Branches cache miss for ${repoId}`);
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  },

  /**
   * Save branches to cache
   * @param {string} repoId - Repository ID
   * @param {Object} data - { branches, branchMetadata, current }
   */
  async saveBranches(repoId, data) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.STORES.BRANCHES, "readwrite");
      const store = tx.objectStore(this.STORES.BRANCHES);
      const request = store.put({
        repoId,
        ...data,
        cachedAt: Date.now()
      });
      request.onsuccess = () => {
        console.log(`[gitCache] Saved ${data.branches?.length || 0} branches for ${repoId}`);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Get cached commits
   * @param {string} repoId - Repository ID
   * @param {string} branch - Branch name
   * @param {string} mode - Mode (activity, full, etc.)
   * @returns {Promise<Object|null>} - { commits, totalCommits } or null
   */
  async getCommits(repoId, branch, mode) {
    await this.init();
    const cacheKey = `${repoId}:${branch}:${mode}`;
    return new Promise((resolve) => {
      const tx = this.db.transaction(this.STORES.COMMITS, "readonly");
      const store = tx.objectStore(this.STORES.COMMITS);
      const request = store.get(cacheKey);
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          console.log(`[gitCache] Commits cache hit for ${cacheKey}: ${result.commits?.length || 0} commits`);
          resolve(result);
        } else {
          console.log(`[gitCache] Commits cache miss for ${cacheKey}`);
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    });
  },

  /**
   * Save commits to cache
   * @param {string} repoId - Repository ID
   * @param {string} branch - Branch name
   * @param {string} mode - Mode (activity, full, etc.)
   * @param {Object} data - { commits, totalCommits }
   */
  async saveCommits(repoId, branch, mode, data) {
    await this.init();
    const cacheKey = `${repoId}:${branch}:${mode}`;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.STORES.COMMITS, "readwrite");
      const store = tx.objectStore(this.STORES.COMMITS);
      const request = store.put({
        cacheKey,
        repoId,
        branch,
        mode,
        ...data,
        cachedAt: Date.now()
      });
      request.onsuccess = () => {
        console.log(`[gitCache] Saved ${data.commits?.length || 0} commits for ${cacheKey}`);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Get cached diff for a file in a commit
   * Diffs are immutable - same SHA + file path always produces same diff
   * @param {string} repoId - Repository ID
   * @param {string} sha - Commit SHA
   * @param {string} filePath - File path
   * @returns {Promise<Object|null>} - { diff, hunks, filePath } or null
   */
  async getDiff(repoId, sha, filePath) {
    await this.init();

    // Check if DIFFS store exists (may not exist if DB was created with older version)
    if (!this.db.objectStoreNames.contains(this.STORES.DIFFS)) {
      console.warn("[gitCache] DIFFS store not found - database needs upgrade. Try refreshing the page.");
      return null;
    }

    const cacheKey = `${repoId}:${sha}:${filePath}`;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(this.STORES.DIFFS, "readonly");
        const store = tx.objectStore(this.STORES.DIFFS);
        const request = store.get(cacheKey);
        request.onsuccess = () => {
          const result = request.result;
          if (result) {
            console.log(`[gitCache] Diff cache hit for ${sha.substring(0, 7)}:${filePath}`);
            resolve(result);
          } else {
            resolve(null);
          }
        };
        request.onerror = () => resolve(null);
      } catch (e) {
        console.warn("[gitCache] Error accessing DIFFS store:", e);
        resolve(null);
      }
    });
  },

  /**
   * Save diff to cache
   * @param {string} repoId - Repository ID
   * @param {string} sha - Commit SHA
   * @param {string} filePath - File path
   * @param {Object} data - { diff, hunks }
   */
  async saveDiff(repoId, sha, filePath, data) {
    await this.init();

    // Check if DIFFS store exists (may not exist if DB was created with older version)
    if (!this.db.objectStoreNames.contains(this.STORES.DIFFS)) {
      console.warn("[gitCache] DIFFS store not found - database needs upgrade. Try refreshing the page.");
      return;
    }

    const cacheKey = `${repoId}:${sha}:${filePath}`;
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(this.STORES.DIFFS, "readwrite");
        const store = tx.objectStore(this.STORES.DIFFS);
        const request = store.put({
          cacheKey,
          repoId,
          sha,
          filePath,
          diff: data.diff,
          hunks: data.hunks,
          cachedAt: Date.now()
        });
        request.onsuccess = () => {
          console.log(`[gitCache] Saved diff for ${sha.substring(0, 7)}:${filePath}`);
          resolve();
        };
        request.onerror = () => reject(request.error);
      } catch (e) {
        console.warn("[gitCache] Error accessing DIFFS store:", e);
        resolve(); // Don't reject, just skip caching
      }
    });
  },

  /**
   * Get cached file list for a commit
   * File lists are immutable - same SHA always has same changed files
   * @param {string} repoId - Repository ID
   * @param {string} sha - Commit SHA
   * @returns {Promise<Array|null>} - Array of FileChange objects or null
   */
  async getFiles(repoId, sha) {
    await this.init();

    if (!this.db.objectStoreNames.contains(this.STORES.FILES)) {
      return null;
    }

    const cacheKey = `${repoId}:${sha}`;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(this.STORES.FILES, "readonly");
        const store = tx.objectStore(this.STORES.FILES);
        const request = store.get(cacheKey);
        request.onsuccess = () => {
          const result = request.result;
          if (result && result.files) {
            console.log(`[gitCache] Files cache hit for ${sha.substring(0, 7)}: ${result.files.length} files`);
            resolve(result.files);
          } else {
            resolve(null);
          }
        };
        request.onerror = () => resolve(null);
      } catch (e) {
        console.warn("[gitCache] Error accessing FILES store:", e);
        resolve(null);
      }
    });
  },

  /**
   * Save file list to cache
   * @param {string} repoId - Repository ID
   * @param {string} sha - Commit SHA
   * @param {Array} files - Array of FileChange objects
   */
  async saveFiles(repoId, sha, files) {
    await this.init();

    if (!this.db.objectStoreNames.contains(this.STORES.FILES)) {
      return;
    }

    const cacheKey = `${repoId}:${sha}`;
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(this.STORES.FILES, "readwrite");
        const store = tx.objectStore(this.STORES.FILES);
        const request = store.put({
          cacheKey,
          repoId,
          sha,
          files,
          cachedAt: Date.now()
        });
        request.onsuccess = () => {
          console.log(`[gitCache] Saved ${files.length} files for ${sha.substring(0, 7)}`);
          resolve();
        };
        request.onerror = () => reject(request.error);
      } catch (e) {
        console.warn("[gitCache] Error accessing FILES store:", e);
        resolve();
      }
    });
  },

  /**
   * Invalidate all cache for a repo
   * @param {string} repoId - Repository ID
   */
  async invalidateRepo(repoId) {
    await this.init();
    console.log(`[gitCache] Invalidating cache for ${repoId}`);

    // Delete from all stores
    const stores = [this.STORES.REPOS, this.STORES.BRANCHES];
    for (const storeName of stores) {
      await new Promise((resolve) => {
        const tx = this.db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        store.delete(repoId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }

    // Delete commits by repoId index
    await new Promise((resolve) => {
      const tx = this.db.transaction(this.STORES.COMMITS, "readwrite");
      const store = tx.objectStore(this.STORES.COMMITS);
      const index = store.index("repoId");
      const request = index.openCursor(IDBKeyRange.only(repoId));
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  },

  /**
   * Check if cache is valid by comparing HEAD and refs
   * @param {string} repoId - Repository ID
   * @param {string} currentHead - Current HEAD SHA
   * @param {string} currentRefsHash - Hash of current refs state
   * @returns {Promise<boolean>}
   */
  async isCacheValid(repoId, currentHead, currentRefsHash) {
    const meta = await this.getRepoMeta(repoId);
    if (!meta) return false;

    const valid = meta.head === currentHead && meta.refsHash === currentRefsHash;
    console.log(`[gitCache] Cache validity for ${repoId}: ${valid}`, {
      cachedHead: meta.head?.substring(0, 7),
      currentHead: currentHead?.substring(0, 7),
      cachedRefs: meta.refsHash?.substring(0, 7),
      currentRefs: currentRefsHash?.substring(0, 7)
    });
    return valid;
  },

  /**
   * Clear all cached data (including immutable diffs and files)
   * @param {boolean} includeImmutable - Whether to also clear immutable cache (diffs, files) (default: true)
   */
  async clearAll(includeImmutable = true) {
    await this.init();
    console.log("[gitCache] Clearing all cache" + (includeImmutable ? " (including diffs and files)" : ""));
    const stores = [this.STORES.REPOS, this.STORES.BRANCHES, this.STORES.COMMITS];
    if (includeImmutable) {
      stores.push(this.STORES.DIFFS);
      stores.push(this.STORES.FILES);
    }
    for (const storeName of stores) {
      await new Promise((resolve) => {
        const tx = this.db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
  },

  /**
   * Get cache statistics
   * @returns {Promise<Object>}
   */
  async getStats() {
    await this.init();
    const stats = { repos: 0, branches: 0, commits: 0, diffs: 0, totalCommits: 0 };

    for (const [key, storeName] of Object.entries(this.STORES)) {
      await new Promise((resolve) => {
        const tx = this.db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const countRequest = store.count();
        countRequest.onsuccess = () => {
          stats[key.toLowerCase()] = countRequest.result;
          resolve();
        };
        countRequest.onerror = () => resolve();
      });
    }

    // Count total commits
    await new Promise((resolve) => {
      const tx = this.db.transaction(this.STORES.COMMITS, "readonly");
      const store = tx.objectStore(this.STORES.COMMITS);
      const request = store.openCursor();
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          stats.totalCommits += cursor.value.commits?.length || 0;
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => resolve();
    });

    return stats;
  }
};

// Export to window
window.gitCache = gitCache;

// Initialize on load
gitCache.init().catch(err => {
  console.warn("[gitCache] Failed to initialize:", err);
});
