const FingerprintManager = require('../src/modules/FingerprintManager');

// Mock chrome.storage.local (Simplified for this test)
global.chrome = {
  storage: {
    local: {
      get: jest.fn(() => Promise.resolve({})),
      set: jest.fn(() => Promise.resolve())
    }
  }
};

// Mock Crypto API
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

describe('FingerprintManager - Duplicate Detection Repro', () => {
  let manager;

  beforeEach(() => {
    manager = new FingerprintManager();
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

    console.log('Hash 1:', hash1);
    console.log('Hash 2:', hash2);

    // Expectation: hashes should be IDENTICAL to prevent duplicates
    expect(hash1).toBe(hash2);
  });

  test('should generate SAME fingerprint for AI reports with variable IDs in steps even if logs are empty', async () => {
     // Scenario: AI analysis without console logs (only visual/DOM analysis)
     const report1 = {
        title: '500 Internal Server Error',
        url: 'https://app.example.com',
        logs: [],
        steps: ['Error with ID: ABC-123']
      };
  
      const report2 = {
        title: '500 Internal Server Error',
        url: 'https://app.example.com',
        logs: [],
        steps: ['Error with ID: XYZ-789']
      };
  
      const hash1 = await manager.generateFingerprint(report1);
      const hash2 = await manager.generateFingerprint(report2);
  
      expect(hash1).toBe(hash2);
  });
});
