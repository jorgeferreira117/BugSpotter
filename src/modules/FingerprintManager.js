/**
 * BugSpotter Fingerprint Manager
 * Generates deterministic fingerprints for bugs to prevent duplicates.
 */
class FingerprintManager {
  constructor() {
    this.storageKey = 'bug_fingerprints';
    this.TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days default TTL
    this._memoryLocks = new Set(); // In-memory lock for race condition prevention
  }

  /**
   * Generates a deterministic fingerprint for a bug report
   * @param {Object} bugData - The bug report data
   * @returns {Promise<string>} SHA-256 hash
   */
  async generateFingerprint(bugData) {
    // 1. Normalize data to ensure determinism
    const components = [];

    // URL: Normalize structure and params
    components.push(this._normalizeUrl(bugData.url));

    // Technical Signals (Errors/Logs) are more reliable than user input
    const errorSignal = bugData.originalError ? this._normalizeError(bugData.originalError) : '';
    const logSignal = this._findSignificantConsoleError(bugData.logs);

    if (errorSignal || logSignal) {
      // If we have technical signals, use them and IGNORE the title
      // This prevents "Login failed" vs "Cannot login" from creating duplicates
      if (errorSignal) components.push(errorSignal);
      if (logSignal) components.push(logSignal);
    } else {
      // 3. Fallback: Visual/Manual Signals
      // If no technical error, rely on the user's input (Title)
      // We normalize the title AND mask dynamic content to catch "Error in Order 123" vs "Error in Order 456"
      const rawTitle = (bugData.title || '').trim();
      components.push(this._maskDynamicContent(rawTitle));
    }

    const fingerprintString = components.join('|');
    return this._hashString(fingerprintString);
  }

  /**
   * Checks if a fingerprint exists locally and is valid (not expired)
   * @param {string} fingerprint 
   * @returns {Promise<Object|null>} The existing bug reference or null
   */
  async checkLocalDuplicate(fingerprint) {
    const data = await chrome.storage.local.get(this.storageKey);
    const registry = data[this.storageKey] || {};
    const entry = registry[fingerprint];

    if (!entry) return null;

    // Check TTL
    if (Date.now() - (entry.savedAt || 0) > this.TTL_MS) {
      // Lazy cleanup: remove expired entry when accessed
      delete registry[fingerprint];
      await chrome.storage.local.set({ [this.storageKey]: registry });
      return null;
    }

    return entry;
  }

  /**
   * Reserves a fingerprint to prevent race conditions during submission
   * @param {string} fingerprint 
   * @returns {Promise<boolean>} True if reserved successfully, False if already exists/reserved
   */
  async reserveFingerprint(fingerprint) {
    // 0. Memory Lock Check (Fast & Synchronous for same-process)
    // Prevents race conditions where two identical requests start simultaneously
    if (this._memoryLocks.has(fingerprint)) {
      return false;
    }
    this._memoryLocks.add(fingerprint);

    try {
      const data = await chrome.storage.local.get(this.storageKey);
      const registry = data[this.storageKey] || {};
      const existing = registry[fingerprint];

      // Se já existe e está confirmado (ou reservado recentemente), rejeitar
      if (existing) {
        // Se estiver confirmado, é duplicado
        if (existing.status === 'confirmed') {
          this._memoryLocks.delete(fingerprint); // Not needed anymore
          return false;
        }
        
        // Se estiver pendente, verificar se expirou (ex: reserva de 5 min)
        const PENDING_TTL = 5 * 60 * 1000;
        if (Date.now() - existing.savedAt < PENDING_TTL) {
          this._memoryLocks.delete(fingerprint); // Not ours to process
          return false; // Ainda está reservado por outro processo
        }
        // Se expirou, permitir sobrescrever (libertar lock morto)
      }

      // Criar reserva
      registry[fingerprint] = {
        status: 'pending',
        savedAt: Date.now()
      };

      await chrome.storage.local.set({ [this.storageKey]: registry });
      return true;
    } catch (error) {
      this._memoryLocks.delete(fingerprint); // Release lock on error
      throw error;
    }
  }

  /**
   * Confirms a previously reserved fingerprint with final ticket data
   * @param {string} fingerprint 
   * @param {Object} metadata - { ticketKey, timestamp, title }
   */
  async confirmFingerprint(fingerprint, metadata) {
    this._memoryLocks.delete(fingerprint); // Release memory lock
    const data = await chrome.storage.local.get(this.storageKey);
    const registry = data[this.storageKey] || {};
    
    // Atualizar apenas se existir (segurança)
    if (registry[fingerprint]) {
      registry[fingerprint] = {
        ...metadata,
        status: 'confirmed',
        savedAt: Date.now()
      };
      await chrome.storage.local.set({ [this.storageKey]: registry });
    }
  }

  /**
   * Releases a reserved fingerprint in case of error
   * @param {string} fingerprint 
   */
  async releaseFingerprint(fingerprint) {
    this._memoryLocks.delete(fingerprint); // Release memory lock
    const data = await chrome.storage.local.get(this.storageKey);
    const registry = data[this.storageKey] || {};
    
    if (registry[fingerprint] && registry[fingerprint].status === 'pending') {
      delete registry[fingerprint];
      await chrome.storage.local.set({ [this.storageKey]: registry });
    }
  }

  /**
   * Removes expired fingerprints from storage
   * @returns {Promise<number>} Number of removed entries
   */
  async cleanupExpired() {
    const data = await chrome.storage.local.get(this.storageKey);
    const registry = data[this.storageKey] || {};
    let removedCount = 0;
    const now = Date.now();

    for (const [fingerprint, entry] of Object.entries(registry)) {
      if (now - (entry.savedAt || 0) > this.TTL_MS) {
        delete registry[fingerprint];
        removedCount++;
      }
    }

    if (removedCount > 0) {
      await chrome.storage.local.set({ [this.storageKey]: registry });
    }
    
    return removedCount;
  }

  /**
   * Saves a fingerprint locally
   * @param {string} fingerprint 
   * @param {Object} metadata - { ticketKey, timestamp, title }
   */
  async saveFingerprint(fingerprint, metadata) {
    const data = await chrome.storage.local.get(this.storageKey);
    const registry = data[this.storageKey] || {};
    
    registry[fingerprint] = {
      ...metadata,
      savedAt: Date.now()
    };

    await chrome.storage.local.set({ [this.storageKey]: registry });
  }

  _normalizeUrl(url) {
    if (!url) return '';
    try {
      const urlObj = new URL(url);
      
      // Mask Pathname (e.g. /stations/123 -> /stations/{id})
      const maskedPath = this._maskDynamicContent(urlObj.pathname);

      // 1. Sort Query Params (a=1&b=2 is same as b=2&a=1)
      const searchParams = new URLSearchParams(urlObj.search);
      const sortedParams = [...searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      
      // 2. Filter out noisy/ephemeral params AND Mask Values
      const filteredParams = sortedParams
        .filter(([key]) => {
          const lowerKey = key.toLowerCase();
          // Remove tracking, timestamps, sessions, random seeds
          return !lowerKey.match(/^(utm_|fbclid|gclid|_t|timestamp|session|token|sid|rand)/);
        })
        .map(([key, value]) => {
          // Mask the value to handle dynamic IDs in query params
          return [key, this._maskDynamicContent(value)];
        });

      // Reconstruct sorted query string
      const queryString = filteredParams.map(([k, v]) => `${k}=${v}`).join('&');
      
      // Return Origin + Masked Path + Sorted/Filtered/Masked Query
      return (urlObj.origin + maskedPath + (queryString ? '?' + queryString : '')).toLowerCase();
    } catch (e) {
      return this._maskDynamicContent(url || '').toLowerCase();
    }
  }

  _normalizeError(error) {
    if (!error) return '';
    // Combine type and message
    const raw = `${error.type || ''}:${error.message || ''}`;
    return this._maskDynamicContent(raw);
  }

  _findSignificantConsoleError(logs) {
    if (!Array.isArray(logs)) return '';
    
    // Prefer the FIRST error as it's often the root cause
    const firstError = logs.find(log => log.type === 'error');
    if (firstError) {
      return this._maskDynamicContent(firstError.message || '');
    }
    return '';
  }

  _maskDynamicContent(str) {
    if (!str) return '';
    return str.toLowerCase()
      // Mask UUIDs (e.g. 123e4567-e89b-...)
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '{uuid}')
      // Mask Mixed Alphanumeric IDs (must contain digit, length >= 4)
      // Catches: QA-SHARED-0001, 295174872-01, flow_b2b
      .replace(/\b(?=[a-z0-9-_]*\d)[a-z0-9-_]{4,}\b/g, '{id}')
      // Mask Uppercase Codes/IDs (e.g. GALP_B2B, SKU123) - Min length 3
      .replace(/\b[A-Z0-9_-]{3,}\b/g, '{id}')
      // Mask Common ID Patterns with prefixes (supporting space, colon, dot, underscore)
      .replace(/(request|req|trace|correlation|transaction|asset|item|user|order|client|group)[._\s]*(id)[:\s=]+[a-z0-9-]+/g, '$1$2: {id}')
      // Mask "entity + number" patterns (e.g., "asset 123", "user 456") - avoiding common words like "version 1", "step 2"
      .replace(/\b(asset|item|user|order|client|group|record|doc|file|report|ticket|issue)\s+#?([a-z0-9-]{3,})\b/g, '$1 {id}')
      // Mask Hex Addresses (e.g. 0x123abc)
      .replace(/0x[0-9a-f]+/g, '{hex}')
      // Mask Generic IDs (long numbers > 4 digits to capture 12345 but verify context)
      .replace(/\b\d{5,}\b/g, '{id}')
      // Mask ISO Dates
      .replace(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/g, '{date}')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  async _hashString(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

// Export for use in background/popup
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FingerprintManager;
} else if (typeof window !== 'undefined') {
  window.FingerprintManager = FingerprintManager;
}
