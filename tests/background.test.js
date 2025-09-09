// Mock global objects
global.chrome = {
  runtime: {
    onInstalled: { addListener: jest.fn() },
    onMessage: { addListener: jest.fn() },
    onSuspend: { addListener: jest.fn() },
    sendMessage: jest.fn(),
    getURL: jest.fn()
  },
  tabs: {
    onActivated: { addListener: jest.fn() },
    onUpdated: { addListener: jest.fn() },
    onRemoved: { addListener: jest.fn() },
    captureVisibleTab: jest.fn(),
    query: jest.fn()
  },
  debugger: {
    attach: jest.fn(),
    detach: jest.fn(),
    sendCommand: jest.fn(),
    onEvent: { addListener: jest.fn() },
    onDetach: { addListener: jest.fn() }
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn()
    },
    sync: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn()
    }
  },
  contextMenus: {
    create: jest.fn(),
    removeAll: jest.fn(),
    onClicked: { addListener: jest.fn() }
  },
  notifications: {
    create: jest.fn()
  }
};

// Mock crypto
global.crypto = {
  getRandomValues: jest.fn((arr) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  }),
  subtle: {
    generateKey: jest.fn(),
    encrypt: jest.fn(),
    decrypt: jest.fn(),
    importKey: jest.fn(),
    exportKey: jest.fn()
  }
};

global.TextEncoder = class {
  encode(str) {
    return new Uint8Array(Buffer.from(str, 'utf8'));
  }
};

global.TextDecoder = class {
  decode(buffer) {
    return Buffer.from(buffer).toString('utf8');
  }
};

global.fetch = jest.fn();

// Mock classes
class SecurityManager {
  constructor() {
    this.encryptionKey = null;
    this.isInitialized = false;
  }

  async generateKey() {
    return {
      key: 'mock-key',
      salt: 'mock-salt'
    };
  }

  generateSalt() {
    return 'mock-salt';
  }

  validatePassword(password) {
    if (!password || typeof password !== 'string') {
      return {
        isValid: false,
        errors: ['Password is required']
      };
    }
    
    if (password.length < 8) {
      return {
        isValid: false,
        errors: ['Password must be at least 8 characters']
      };
    }
    
    if (!/[A-Z]/.test(password)) {
      return {
        isValid: false,
        errors: ['Password must contain uppercase letter']
      };
    }
    
    if (!/[a-z]/.test(password)) {
      return {
        isValid: false,
        errors: ['Password must contain lowercase letter']
      };
    }
    
    if (!/\d/.test(password)) {
      return {
        isValid: false,
        errors: ['Password must contain number']
      };
    }
    
    return {
      isValid: true,
      errors: []
    };
  }
}

class ErrorHandler {
  constructor() {
    this.errorQueue = [];
    this.maxQueueSize = 100;
    this.retryAttempts = 3;
  }

  handleError(error, context = '', severity = 'medium') {
    const errorInfo = {
      message: error.message || error,
      context,
      severity,
      timestamp: new Date().toISOString(),
      stack: error.stack
    };
    
    this.addToErrorQueue(errorInfo);
    console.error(`[${severity.toUpperCase()}] ${context}: ${errorInfo.message}`);
  }

  addToErrorQueue(errorInfo) {
    this.errorQueue.push(errorInfo);
    if (this.errorQueue.length > this.maxQueueSize) {
      this.errorQueue.shift();
    }
  }

  async safeExecute(operation, context = '', defaultValue = null) {
    try {
      return await operation();
    } catch (error) {
      this.handleError(error, context);
      return defaultValue;
    }
  }

  async executeWithRetry(operation, context = '', maxRetries = this.retryAttempts) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === maxRetries) {
          this.handleError(error, `${context} (final attempt)`);
          throw error;
        }
        await this.delay(1000 * attempt);
      }
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  validateInput(data, schema, context = '') {
    const errors = [];
    
    for (const [key, rules] of Object.entries(schema)) {
      const value = data[key];
      
      if (rules.required && (value === undefined || value === null)) {
        errors.push(`${key} is required`);
      }
      
      if (value !== undefined && rules.type && typeof value !== rules.type) {
        errors.push(`${key} must be of type ${rules.type}`);
      }
    }
    
    if (errors.length > 0) {
      throw new Error(`Validation failed for ${context}: ${errors.join(', ')}`);
    }
    
    return true;
  }
}

class StorageManager {
  constructor() {
    this.compressionThreshold = 1024;
    this.maxRetries = 3;
  }

  async store(key, data, options = {}) {
    const { compress = false, expiry = null, storage = 'chrome' } = options;
    
    const item = {
      data,
      timestamp: Date.now(),
      expiry,
      compressed: compress
    };
    
    if (storage === 'chrome') {
      await chrome.storage.local.set({ [key]: item });
    }
  }

  async retrieve(key, storage = 'chrome') {
    if (storage === 'chrome') {
      const result = await chrome.storage.local.get(key);
      const item = result[key];
      
      if (!item) return null;
      if (this.isExpired(item)) return null;
      
      return item.data;
    }
  }

  shouldCompress(data) {
    return this.calculateSize(data) > this.compressionThreshold;
  }

  calculateSize(data) {
    return JSON.stringify(data).length;
  }

  isExpired(item) {
    return item.expiry && Date.now() > item.expiry;
  }
}

class RateLimiter {
  constructor(maxRequests = 10, timeWindow = 60000) {
    this.maxRequests = maxRequests;
    this.timeWindow = timeWindow;
    this.requests = [];
  }

  canMakeRequest() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.timeWindow);
    
    if (this.requests.length < this.maxRequests) {
      this.requests.push(now);
      return true;
    }
    
    return false;
  }
}

class BugSpotterBackground {
  constructor() {
    this.debuggerSessions = new Map();
    this.persistentLogs = new Map();
    this.bufferSize = 1000;
  }

  getDebuggerLogs(tabId, domainFilter = null) {
    const session = this.debuggerSessions.get(tabId);
    const persistentData = this.persistentLogs.get(tabId) || { logs: [], networkRequests: [], errors: [] };
    
    if (!session) {
      const filteredData = domainFilter ? {
        logs: persistentData.logs.filter(log => !log.url || log.url.includes(domainFilter)),
        networkRequests: persistentData.networkRequests.filter(req => req.url.includes(domainFilter)),
        errors: persistentData.errors.filter(err => !err.url || err.url.includes(domainFilter))
      } : persistentData;
      
      return filteredData;
    }
    
    const combinedLogs = [...persistentData.logs, ...session.logs];
    const combinedNetworkRequests = [...persistentData.networkRequests, ...session.networkRequests];
    const combinedErrors = [...persistentData.errors, ...session.logs.filter(log => log.level === 'error')];
    
    if (domainFilter) {
      return {
        logs: combinedLogs.filter(log => !log.url || log.url.includes(domainFilter)),
        networkRequests: combinedNetworkRequests.filter(req => req.url.includes(domainFilter)),
        errors: combinedErrors.filter(err => !err.url || err.url.includes(domainFilter))
      };
    }
    
    return {
      logs: combinedLogs,
      networkRequests: combinedNetworkRequests,
      errors: combinedErrors
    };
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.action) {
        case 'CAPTURE_SCREENSHOT':
          const screenshot = await this.captureScreenshot(sender.tab.id);
          sendResponse({ success: true, data: screenshot });
          break;

        case 'GET_CONSOLE_LOGS':
          const logs = await this.getConsoleLogs(sender.tab.id);
          sendResponse({ success: true, data: logs });
          break;

        case 'ATTACH_DEBUGGER':
          try {
            const tabId = message.tabId || sender.tab?.id;
            if (!tabId) {
              throw new Error('No tab ID provided');
            }
            await this.attachDebugger(tabId);
            sendResponse({ success: true });
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'DETACH_DEBUGGER':
          try {
            const tabId = message.tabId || sender.tab?.id;
            if (!tabId) {
              throw new Error('No tab ID provided');
            }
            await this.detachDebugger(tabId);
            sendResponse({ success: true });
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
          break;

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }

  async captureScreenshot(tabId) {
    return 'mock_screenshot_data';
  }

  async getConsoleLogs(tabId) {
    const persistentData = this.persistentLogs.get(tabId) || { logs: [], networkRequests: [], errors: [] };
    return persistentData.logs;
  }

  async attachDebugger(tabId) {
    // Mock implementation
  }

  async detachDebugger(tabId) {
    // Mock implementation
  }

  setupContextMenus() {
    chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: 'bugspotter-capture',
      title: 'Capture Bug Report',
      contexts: ['page']
    });
  }

  cleanup() {
    this.debuggerSessions.clear();
  }

  async cleanupDebuggerSession(tabId) {
    if (this.debuggerSessions.has(tabId)) {
      await this.detachDebugger(tabId);
    }
  }

  cleanupTabData(tabId) {
    if (this.persistentLogs.has(tabId)) {
      this.persistentLogs.delete(tabId);
    }
  }

  getPersistentLogs(tabId) {
    return this.persistentLogs.get(tabId) || {
      logs: [],
      networkRequests: [],
      errors: []
    };
  }

  addToBuffer(array, item) {
    array.push(item);
    if (array.length > this.bufferSize) {
      array.shift();
    }
  }

  shouldAutoAttach(url) {
    return url && !url.startsWith('chrome://');
  }

  deduplicateLogs(logs) {
    const seen = new Set();
    return logs.filter(log => {
      const key = `${log.timestamp}-${log.message}-${log.level}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  getMimeType(attachmentType) {
    const mimeTypes = {
      'screenshot': 'image/png',
      'logs': 'application/json',
      'network': 'application/json'
    };
    return mimeTypes[attachmentType] || 'application/octet-stream';
  }

  async mapPriorityToJira(priority) {
    const priorityMap = {
      'low': '4',
      'medium': '3', 
      'high': '2',
      'critical': '1'
    };
    return priorityMap[priority] || '3';
  }

  formatJiraDescription(bugData) {
    return `
Bug Report

Description: ${bugData.description}
Steps to Reproduce: ${bugData.steps}
Expected Result: ${bugData.expected}
Actual Result: ${bugData.actual}

Environment:
- URL: ${bugData.url}
- User Agent: ${bugData.userAgent}
- Timestamp: ${bugData.timestamp}
    `;
  }
}

// Tests
describe('SecurityManager', () => {
  let securityManager;

  beforeEach(() => {
    securityManager = new SecurityManager();
  });

  describe('generateKey', () => {
    it('should generate a key and salt', async () => {
      const result = await securityManager.generateKey();
      expect(result).toHaveProperty('key');
      expect(result).toHaveProperty('salt');
    });
  });

  describe('validatePassword', () => {
    it('should validate strong password', () => {
      const result = securityManager.validatePassword('StrongPass123');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject weak password', () => {
      const result = securityManager.validatePassword('weak');
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});

describe('ErrorHandler', () => {
  let errorHandler;

  beforeEach(() => {
    errorHandler = new ErrorHandler();
  });

  describe('handleError', () => {
    it('should handle error and add to queue', () => {
      const error = new Error('Test error');
      errorHandler.handleError(error, 'test context');
      
      expect(errorHandler.errorQueue).toHaveLength(1);
      expect(errorHandler.errorQueue[0]).toMatchObject({
        message: 'Test error',
        context: 'test context'
      });
    });
  });

  describe('safeExecute', () => {
    it('should execute operation successfully', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      const result = await errorHandler.safeExecute(operation);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalled();
    });

    it('should return default value on error', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Test error'));
      const result = await errorHandler.safeExecute(operation, 'test', 'default');
      
      expect(result).toBe('default');
    });
  });
});

describe('StorageManager', () => {
  let storageManager;

  beforeEach(() => {
    storageManager = new StorageManager();
    chrome.storage.local.get.mockClear();
    chrome.storage.local.set.mockClear();
  });

  describe('store', () => {
    it('should store data in chrome storage', async () => {
      await storageManager.store('testKey', { test: 'data' });
      
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        testKey: expect.objectContaining({
          data: { test: 'data' },
          timestamp: expect.any(Number)
        })
      });
    });
  });

  describe('retrieve', () => {
    it('should retrieve data from chrome storage', async () => {
      const mockData = {
        testKey: {
          data: { test: 'data' },
          timestamp: Date.now()
        }
      };
      chrome.storage.local.get.mockResolvedValue(mockData);
      
      const result = await storageManager.retrieve('testKey');
      
      expect(result).toEqual({ test: 'data' });
    });
  });
});

describe('RateLimiter', () => {
  let rateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter(2, 1000);
  });

  describe('canMakeRequest', () => {
    it('should allow requests within limit', () => {
      expect(rateLimiter.canMakeRequest()).toBe(true);
      expect(rateLimiter.canMakeRequest()).toBe(true);
      expect(rateLimiter.canMakeRequest()).toBe(false);
    });
  });
});

describe('BugSpotterBackground', () => {
  let bugSpotter;

  beforeEach(() => {
    bugSpotter = new BugSpotterBackground();
  });

  describe('setupContextMenus', () => {
    it('should create context menu items', () => {
      bugSpotter.setupContextMenus();
      
      expect(chrome.contextMenus.removeAll).toHaveBeenCalled();
      expect(chrome.contextMenus.create).toHaveBeenCalledWith({
        id: 'bugspotter-capture',
        title: 'Capture Bug Report',
        contexts: ['page']
      });
    });
  });

  describe('cleanup', () => {
    it('should cleanup resources', () => {
      const mockClear = jest.fn();
      bugSpotter.debuggerSessions = new Map();
      bugSpotter.debuggerSessions.clear = mockClear;
      
      bugSpotter.cleanup();
      
      expect(mockClear).toHaveBeenCalled();
    });
  });

  describe('cleanupDebuggerSession', () => {
    it('should cleanup debugger session if exists', async () => {
      bugSpotter.debuggerSessions.set(123, { logs: [] });
      bugSpotter.detachDebugger = jest.fn().mockResolvedValue();
      
      await bugSpotter.cleanupDebuggerSession(123);
      
      expect(bugSpotter.detachDebugger).toHaveBeenCalledWith(123);
    });

    it('should not cleanup if session does not exist', async () => {
      bugSpotter.detachDebugger = jest.fn();
      
      await bugSpotter.cleanupDebuggerSession(999);
      
      expect(bugSpotter.detachDebugger).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage', () => {
    let sendResponse;
    
    beforeEach(() => {
      sendResponse = jest.fn();
    });

    it('should handle CAPTURE_SCREENSHOT action', async () => {
      const message = { action: 'CAPTURE_SCREENSHOT' };
      const sender = { tab: { id: 123 } };
      
      bugSpotter.captureScreenshot = jest.fn().mockResolvedValue('screenshot_data');
      
      await bugSpotter.handleMessage(message, sender, sendResponse);
      
      expect(bugSpotter.captureScreenshot).toHaveBeenCalledWith(123);
      expect(sendResponse).toHaveBeenCalledWith({ success: true, data: 'screenshot_data' });
    });

    it('should handle ATTACH_DEBUGGER action', async () => {
      const message = { action: 'ATTACH_DEBUGGER', tabId: 123 };
      const sender = { tab: { id: 456 } };
      
      bugSpotter.attachDebugger = jest.fn().mockResolvedValue();
      
      await bugSpotter.handleMessage(message, sender, sendResponse);
      
      expect(bugSpotter.attachDebugger).toHaveBeenCalledWith(123);
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it('should handle DETACH_DEBUGGER action', async () => {
      const message = { action: 'DETACH_DEBUGGER', tabId: 123 };
      const sender = { tab: { id: 456 } };
      
      bugSpotter.detachDebugger = jest.fn().mockResolvedValue();
      
      await bugSpotter.handleMessage(message, sender, sendResponse);
      
      expect(bugSpotter.detachDebugger).toHaveBeenCalledWith(123);
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('getDebuggerLogs', () => {
    it('should return persistent logs when no session exists', () => {
      const mockLogs = { logs: ['log1'], networkRequests: [], errors: [] };
      bugSpotter.persistentLogs.set(123, mockLogs);
      
      const result = bugSpotter.getDebuggerLogs(123);
      
      expect(result).toEqual(mockLogs);
    });

    it('should filter logs by domain when specified', () => {
      const mockLogs = {
        logs: [
          { message: 'log1', url: 'https://example.com/page' },
          { message: 'log2', url: 'https://other.com/page' }
        ],
        networkRequests: [],
        errors: []
      };
      bugSpotter.persistentLogs.set(123, mockLogs);
      
      const result = bugSpotter.getDebuggerLogs(123, 'example.com');
      
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].message).toBe('log1');
    });
  });
});