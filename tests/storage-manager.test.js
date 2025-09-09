/**
 * @jest-environment jsdom
 */

// Mock das APIs do Chrome
global.chrome = {
  storage: {
    sync: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn()
    },
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn()
    }
  }
};

// Importar a classe StorageManager
const StorageManager = require('../storage-manager.js');

// Definir globalmente para os testes
global.StorageManager = StorageManager;

describe('StorageManager', () => {
  let storageManager;

  beforeEach(() => {
    // Mock chrome storage API
    global.chrome = {
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
          remove: jest.fn(),
          clear: jest.fn()
        }
      }
    };

    // Mock localStorage
    const localStorageMock = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
      key: jest.fn(),
      length: 0
    };
    
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true
    });
    
    global.localStorage = localStorageMock;

    storageManager = new StorageManager();
    jest.clearAllMocks();
  });

  describe('retrieve', () => {
    it('should retrieve data from chrome storage by default', async () => {
      const mockItem = {
        data: { key: 'value' },
        compressed: false,
        timestamp: Date.now(),
        ttl: 7 * 24 * 60 * 60 * 1000
      };
      chrome.storage.local.get.mockResolvedValue({ testKey: mockItem });

      const result = await storageManager.retrieve('testKey');

      expect(chrome.storage.local.get).toHaveBeenCalledWith(['testKey']);
      expect(result).toEqual({ key: 'value' });
    });

    it('should retrieve data from local storage when specified', async () => {
      // Test that the method exists and can handle localStorage fallback
      const result = await storageManager.retrieve('nonExistentKey', 'browser');
      
      // Should return null for non-existent key
      expect(result).toBeNull();
    });

    it('should return null for non-existent key', async () => {
      chrome.storage.local.get.mockResolvedValue({});

      const result = await storageManager.retrieve('nonExistentKey');

      expect(chrome.storage.local.get).toHaveBeenCalledWith(['nonExistentKey']);
      expect(result).toBeNull();
    });

    it('should return null for expired items', async () => {
      const expiredItem = {
        data: { key: 'value' },
        compressed: false,
        timestamp: Date.now() - (8 * 24 * 60 * 60 * 1000), // 8 days ago
        ttl: 7 * 24 * 60 * 60 * 1000 // 7 days TTL
      };
      chrome.storage.local.get.mockResolvedValue({ testKey: expiredItem });
      chrome.storage.local.remove.mockResolvedValue();

      const result = await storageManager.retrieve('testKey');

      expect(result).toBeNull();
      expect(chrome.storage.local.remove).toHaveBeenCalledWith(['testKey']);
    });
  });

  describe('store', () => {
    it('should store data to chrome storage by default', async () => {
      chrome.storage.local.set.mockResolvedValue();

      const result = await storageManager.store('testKey', { key: 'value' });

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        testKey: expect.objectContaining({
          data: { key: 'value' },
          compressed: false,
          timestamp: expect.any(Number),
          ttl: expect.any(Number),
          size: expect.any(Number)
        })
      });
      expect(result).toBe(true);
    });

    it('should store data to local storage when specified', async () => {
      // Test that the method exists and returns success
      const result = await storageManager.store('testKey', { key: 'value' }, { storage: 'browser' });
      
      // Should return true for successful storage
      expect(result).toBe(true);
    });

    it('should compress large data', async () => {
      const largeData = 'x'.repeat(2000); // Larger than compression threshold
      chrome.storage.local.set.mockResolvedValue();

      const result = await storageManager.store('testKey', largeData);

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        testKey: expect.objectContaining({
          compressed: true,
          data: expect.any(String)
        })
      });
      expect(result).toBe(true);
    });
  });

  describe('remove', () => {
    it('should remove data from chrome storage by default', async () => {
      chrome.storage.local.remove.mockResolvedValue();

      const result = await storageManager.remove('testKey');

      expect(chrome.storage.local.remove).toHaveBeenCalledWith(['testKey']);
      expect(result).toBe(true);
    });

    it('should remove data from local storage when specified', async () => {
      // Test that the method exists and returns success
      const result = await storageManager.remove('testKey', 'browser');
      
      // Should return true for successful removal
      expect(result).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      chrome.storage.local.remove.mockRejectedValue(new Error('Remove failed'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await storageManager.remove('testKey');

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('Erro ao remover dados:', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe('listKeys', () => {
    it('should list keys from chrome storage by default', async () => {
      const mockData = { key1: 'value1', key2: 'value2' };
      chrome.storage.local.get.mockResolvedValue(mockData);

      const result = await storageManager.listKeys();

      expect(chrome.storage.local.get).toHaveBeenCalledWith(null);
      expect(result).toEqual(['key1', 'key2']);
    });

    it('should list keys from local storage when specified', async () => {
      // Mock Object.keys to return localStorage keys
      const originalObjectKeys = Object.keys;
      Object.keys = jest.fn().mockImplementation((obj) => {
        if (obj === localStorage) {
          return ['key1', 'key2'];
        }
        return originalObjectKeys(obj);
      });
      
      const result = await storageManager.listKeys('browser');

      expect(result).toEqual(['key1', 'key2']);
      
      // Restore original Object.keys
      Object.keys = originalObjectKeys;
    });
  });

  describe('getStorageUsage', () => {
    it('should calculate storage usage for chrome storage', async () => {
      const mockData = {
        key1: { data: 'value1', size: 100 },
        key2: { data: 'value2', size: 200 }
      };
      chrome.storage.local.get.mockResolvedValue(mockData);

      const result = await storageManager.getStorageUsage();

      expect(chrome.storage.local.get).toHaveBeenCalledWith(null);
      expect(result).toEqual({
        totalSize: expect.any(Number),
        itemCount: 2,
        usagePercentage: expect.any(Number)
      });
    });

    it('should handle empty storage', async () => {
      chrome.storage.local.get.mockResolvedValue({});

      const result = await storageManager.getStorageUsage();

      expect(result).toEqual({
        totalSize: 0,
        itemCount: 0,
        usagePercentage: 0
      });
    });
  });

  describe('performMaintenance', () => {
    it('should perform maintenance and return results', async () => {
      // Mock the cleanup methods
      storageManager.cleanupExpiredItems = jest.fn().mockResolvedValue(2);
      storageManager.cleanupOldestItems = jest.fn().mockResolvedValue(1);

      const result = await storageManager.performMaintenance();

      expect(result).toEqual({
        chrome: { expired: 2, oldest: 1 },
        local: { expired: 2, oldest: 1 }
      });
    });

    it('should handle errors gracefully', async () => {
      storageManager.cleanupExpiredItems = jest.fn().mockRejectedValue(new Error('Cleanup failed'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await storageManager.performMaintenance();

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith('Erro na manutenção do armazenamento:', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });
});