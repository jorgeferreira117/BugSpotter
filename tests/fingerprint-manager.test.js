const FingerprintManager = require('../src/modules/FingerprintManager');

// Mock chrome.storage.local
const mockStorage = {};
global.chrome = {
  storage: {
    local: {
      get: jest.fn((key) => Promise.resolve({ [key]: mockStorage[key] })),
      set: jest.fn((data) => {
        Object.assign(mockStorage, data);
        return Promise.resolve();
      })
    }
  }
};

// Mock Crypto API (SubtleCrypto)
const cryptoNode = require('crypto');
Object.defineProperty(global, 'crypto', {
  value: {
    subtle: {
      digest: jest.fn(async (algo, data) => {
        const hash = cryptoNode.createHash('sha256').update(data).digest();
        return hash.buffer;
      })
    },
    getRandomValues: (arr) => cryptoNode.randomFillSync(arr)
  },
  writable: true
});
global.TextEncoder = require('util').TextEncoder;

describe('FingerprintManager', () => {
  let manager;

  beforeEach(() => {
    manager = new FingerprintManager();
    // Reset storage
    for (const key in mockStorage) delete mockStorage[key];
    jest.clearAllMocks();
  });

  describe('generateFingerprint', () => {
    test('should generate identical fingerprints for identical inputs', async () => {
      const bugData = {
        url: 'https://example.com/app',
        title: 'Login Error',
        originalError: { type: 'TypeError', message: 'Failed to fetch' },
        logs: []
      };

      const hash1 = await manager.generateFingerprint(bugData);
      const hash2 = await manager.generateFingerprint({ ...bugData });

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex length
    });

    test('should ignore query param order in URL', async () => {
      const bug1 = {
        url: 'https://example.com?a=1&b=2',
        title: 'Error',
        logs: []
      };
      const bug2 = {
        url: 'https://example.com?b=2&a=1',
        title: 'Error',
        logs: []
      };

      const hash1 = await manager.generateFingerprint(bug1);
      const hash2 = await manager.generateFingerprint(bug2);

      expect(hash1).toBe(hash2);
    });

    test('should ignore noisy query params (utm, timestamp)', async () => {
      const bug1 = {
        url: 'https://example.com?id=123',
        title: 'Error',
        logs: []
      };
      const bug2 = {
        url: 'https://example.com?id=123&utm_source=google&timestamp=99999',
        title: 'Error',
        logs: []
      };

      const hash1 = await manager.generateFingerprint(bug1);
      const hash2 = await manager.generateFingerprint(bug2);

      expect(hash1).toBe(hash2);
    });

    test('should mask dynamic content in error messages (UUIDs, Dates)', async () => {
      const bug1 = {
        url: 'https://example.com',
        originalError: { message: 'User 123e4567-e89b-12d3-a456-426614174000 failed at 2023-10-01T12:00:00' },
        logs: []
      };
      const bug2 = {
        url: 'https://example.com',
        originalError: { message: 'User 987fcdeb-51a2-43c1-b987-123456789012 failed at 2024-01-01T09:00:00' },
        logs: []
      };

      const hash1 = await manager.generateFingerprint(bug1);
      const hash2 = await manager.generateFingerprint(bug2);

      expect(hash1).toBe(hash2);
    });

    test('should prioritize technical signals over title', async () => {
      // Two bugs with different titles but SAME error
      const bug1 = {
        url: 'https://example.com',
        title: 'Login failed',
        originalError: { message: 'Network Error' },
        logs: []
      };
      const bug2 = {
        url: 'https://example.com',
        title: 'Cannot login to system', // Different title
        originalError: { message: 'Network Error' }, // Same error
        logs: []
      };

      const hash1 = await manager.generateFingerprint(bug1);
      const hash2 = await manager.generateFingerprint(bug2);

      expect(hash1).toBe(hash2);
    });

    test('should generate SAME fingerprint for AI reports with identical title but variable IDs in logs/steps', async () => {
      // Report 1: AI generated, ID "REQ-111" in logs and steps
      const report1 = {
        title: '500 Internal Server Error when fetching asset snapshot properties',
        url: 'https://app.example.com/assets',
        // AI reports might not have originalError if not captured from window.onerror
        originalError: null, 
        logs: [
          { type: 'error', message: 'Failed to load asset snapshot. Request ID: REQ-111. Status: 500' }
        ],
        steps: [
          '1. Go to assets page',
          '2. Observe error "Request ID: REQ-111"'
        ]
      };

      // Report 2: Same error, different ID "REQ-222"
      const report2 = {
        title: '500 Internal Server Error when fetching asset snapshot properties',
        url: 'https://app.example.com/assets',
        originalError: null,
        logs: [
          { type: 'error', message: 'Failed to load asset snapshot. Request ID: REQ-222. Status: 500' }
        ],
        steps: [
          '1. Go to assets page',
          '2. Observe error "Request ID: REQ-222"'
        ]
      };

      const hash1 = await manager.generateFingerprint(report1);
      const hash2 = await manager.generateFingerprint(report2);

      // Expectation: hashes should be IDENTICAL to prevent duplicates
      expect(hash1).toBe(hash2);
    });

    test('should fallback to title if no technical signals exist', async () => {
      const bug1 = {
        url: 'https://example.com',
        title: 'Visual glitch in header',
        logs: []
      };
      const bug2 = {
        url: 'https://example.com',
        title: 'visual glitch in header ', // Different casing/spacing
        logs: []
      };

      const hash1 = await manager.generateFingerprint(bug1);
      const hash2 = await manager.generateFingerprint(bug2);

      expect(hash1).toBe(hash2);
    });
  });

  describe('Local Storage Operations', () => {
    test('saveFingerprint should store metadata', async () => {
      const hash = 'abc123hash';
      const metadata = { ticketKey: 'BUG-1', title: 'Test' };

      await manager.saveFingerprint(hash, metadata);

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          bug_fingerprints: expect.objectContaining({
            [hash]: expect.objectContaining({
              ticketKey: 'BUG-1',
              savedAt: expect.any(Number)
            })
          })
        })
      );
    });

    test('checkLocalDuplicate should return stored metadata', async () => {
      const hash = 'existingHash';
      const now = Date.now();
      mockStorage['bug_fingerprints'] = {
        [hash]: { ticketKey: 'BUG-99', savedAt: now }
      };

      const result = await manager.checkLocalDuplicate(hash);
      expect(result).toEqual({ ticketKey: 'BUG-99', savedAt: now });
    });

    test('checkLocalDuplicate should return null and delete if expired', async () => {
      const hash = 'expiredHash';
      const expiredTime = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
      
      mockStorage['bug_fingerprints'] = {
        [hash]: { ticketKey: 'BUG-OLD', savedAt: expiredTime }
      };

      const result = await manager.checkLocalDuplicate(hash);
      
      expect(result).toBeNull();
      // Should verify it was removed from storage (lazy cleanup)
      expect(chrome.storage.local.set).toHaveBeenCalled();
    });

    test('cleanupExpired should remove all old entries', async () => {
      const oldHash = 'old';
      const newHash = 'new';
      const now = Date.now();
      
      mockStorage['bug_fingerprints'] = {
        [oldHash]: { savedAt: now - (8 * 24 * 60 * 60 * 1000) },
        [newHash]: { savedAt: now }
      };

      const count = await manager.cleanupExpired();
      
      expect(count).toBe(1);
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          bug_fingerprints: {
            [newHash]: expect.anything()
          }
        })
      );
    });
  });
});
