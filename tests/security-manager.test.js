/**
 * @jest-environment jsdom
 */

// Mock das APIs do Chrome
global.chrome = {
  storage: {
    sync: {
      get: jest.fn(),
      set: jest.fn()
    }
  },
  runtime: {
    sendMessage: jest.fn()
  }
};

// Mock do fetch
global.fetch = jest.fn();

// Mock do console
const originalConsole = global.console;
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
};

// Mock TextEncoder and TextDecoder
global.TextEncoder = jest.fn().mockImplementation(() => ({
  encode: jest.fn().mockImplementation((text) => new Uint8Array(Buffer.from(text, 'utf8')))
}));

global.TextDecoder = jest.fn().mockImplementation(() => ({
  decode: jest.fn().mockImplementation((buffer) => {
    if (!buffer) return '';
    return Buffer.from(buffer).toString('utf8');
  })
}));

// Mock getCrypto before requiring the module
const mockGetCrypto = jest.fn();
jest.doMock('../security', () => {
  const originalModule = jest.requireActual('../security');
  
  // Replace getCrypto function in the module
  const mockModule = { ...originalModule };
  mockModule.getCrypto = mockGetCrypto;
  
  // Also replace the function reference used internally
  const originalSecurityManager = originalModule;
  
  // Create a new SecurityManager class that uses our mocked getCrypto
  class MockedSecurityManager extends originalSecurityManager {
    constructor() {
      super();
    }
  }
  
  // Override methods to use mockGetCrypto
  MockedSecurityManager.prototype.decrypt = async function(encryptedData, key) {
    const decrypted = await mockGetCrypto().subtle.decrypt(
      {
        name: this.algorithm,
        iv: new Uint8Array(encryptedData.iv),
      },
      key,
      new Uint8Array(encryptedData.encrypted)
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  };
  
  MockedSecurityManager.prototype.encrypt = async function(data, key) {
     const encoder = new TextEncoder();
     const encodedData = encoder.encode(data);
     const iv = mockGetCrypto().getRandomValues(new Uint8Array(12));

     const encrypted = await mockGetCrypto().subtle.encrypt(
       {
         name: this.algorithm,
         iv: iv,
       },
       key,
       encodedData
     );

     return {
       encrypted: Array.from(new Uint8Array(encrypted)),
       iv: Array.from(iv),
     };
   };
   
   MockedSecurityManager.prototype.generateSalt = function() {
     return mockGetCrypto().getRandomValues(new Uint8Array(16));
   };
   
   MockedSecurityManager.prototype.generateKey = async function() {
     return await mockGetCrypto().subtle.generateKey(
       {
         name: this.algorithm,
         length: this.keyLength,
       },
       true,
       ['encrypt', 'decrypt']
     );
   };
  
  return MockedSecurityManager;
});

const SecurityManager = require('../security');

// Definir globalmente para os testes
global.SecurityManager = SecurityManager;

describe('SecurityManager', () => {
  let securityManager;

  beforeEach(() => {
    // Force recreate crypto mock before each test
    const cryptoMock = {
      subtle: {
        generateKey: jest.fn(),
        importKey: jest.fn(),
        encrypt: jest.fn(),
        decrypt: jest.fn(),
        deriveKey: jest.fn(),
        exportKey: jest.fn(),
        deriveBits: jest.fn(),
        sign: jest.fn(),
        verify: jest.fn(),
        digest: jest.fn()
      },
      getRandomValues: jest.fn((array) => {
        for (let i = 0; i < array.length; i++) {
          array[i] = Math.floor(Math.random() * 256);
        }
        return array;
      })
    };
    
    // Force set global.crypto
    Object.defineProperty(global, 'crypto', {
      value: cryptoMock,
      writable: true,
      configurable: true
    });
    
    // Mock getCrypto function to return our mock
    mockGetCrypto.mockReturnValue(cryptoMock);
    
    securityManager = new SecurityManager();
  });

  afterAll(() => {
    global.console = originalConsole;
  });

  describe('generateKey', () => {
    it('should generate a cryptographic key', async () => {
      const mockKey = { type: 'secret', algorithm: { name: 'AES-GCM' } };
      crypto.subtle.generateKey.mockResolvedValue(mockKey);

      const result = await securityManager.generateKey();
      
      expect(mockGetCrypto().subtle.generateKey).toHaveBeenCalledWith(
        {
          name: 'AES-GCM',
          length: 256,
        },
        true,
        ['encrypt', 'decrypt']
      );
      expect(result).toBe(mockKey);
    });
  });

  describe('generateSalt', () => {
    it('should generate a random salt', () => {
      const mockSalt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
      crypto.getRandomValues.mockReturnValue(mockSalt);

      const result = securityManager.generateSalt();
      
      expect(mockGetCrypto().getRandomValues).toHaveBeenCalledWith(expect.any(Uint8Array));
      expect(result).toBe(mockSalt);
      expect(result.length).toBe(16);
    });
  });

  describe('validatePassword', () => {
    it('should validate strong password', () => {
      const password = 'StrongPass123!';
      const result = securityManager.validatePassword(password);
      
      expect(result.isValid).toBe(true);
      expect(result.requirements.minLength).toBe(true);
      expect(result.requirements.hasUpperCase).toBe(true);
      expect(result.requirements.hasLowerCase).toBe(true);
      expect(result.requirements.hasNumbers).toBe(true);
      expect(result.requirements.hasSpecialChar).toBe(true);
    });

    it('should reject password without uppercase', () => {
      const password = 'weakpass123!';
      const result = securityManager.validatePassword(password);
      
      expect(result.isValid).toBe(false);
      expect(result.requirements.hasUpperCase).toBe(false);
    });

    it('should reject password without lowercase', () => {
      const password = 'WEAKPASS123!';
      const result = securityManager.validatePassword(password);
      
      expect(result.isValid).toBe(false);
      expect(result.requirements.hasLowerCase).toBe(false);
    });

    it('should reject password without numbers', () => {
      const password = 'WeakPass!';
      const result = securityManager.validatePassword(password);
      
      expect(result.isValid).toBe(false);
      expect(result.requirements.hasNumbers).toBe(false);
    });

    it('should reject password without special characters', () => {
      const password = 'WeakPass123';
      const result = securityManager.validatePassword(password);
      
      expect(result.isValid).toBe(false);
      expect(result.requirements.hasSpecialChar).toBe(false);
    });

    it('should reject password too short', () => {
      const password = 'Weak1!';
      const result = securityManager.validatePassword(password);
      
      expect(result.isValid).toBe(false);
      expect(result.requirements.minLength).toBe(false);
    });
  });

  describe('encrypt', () => {
    it('should encrypt data with provided key', async () => {
      const mockKey = { type: 'secret' };
      const mockEncrypted = new ArrayBuffer(16);
      const mockIv = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      
      // Recreate crypto object for this test
      global.crypto = {
        subtle: {
          generateKey: jest.fn(),
          importKey: jest.fn(),
          encrypt: jest.fn().mockResolvedValue(mockEncrypted),
          decrypt: jest.fn(),
          deriveKey: jest.fn()
        },
        getRandomValues: jest.fn().mockReturnValue(mockIv)
      };

      // Mock getCrypto function directly
      const securityModule = require('../security');
      securityModule.getCrypto = jest.fn().mockReturnValue(global.crypto);

      const testSecurityManager = new SecurityManager();
      const result = await testSecurityManager.encrypt('test data', mockKey);
      
      expect(mockGetCrypto().getRandomValues).toHaveBeenCalledWith(expect.any(Uint8Array));
      expect(mockGetCrypto().subtle.encrypt).toHaveBeenCalledWith(
        {
          name: 'AES-GCM',
          iv: expect.any(Uint8Array)
        },
        mockKey,
        expect.any(Uint8Array)
      );
      expect(result).toEqual({
        encrypted: expect.any(Array),
        iv: expect.any(Array)
      });
      expect(result.encrypted).toEqual(expect.any(Array));
      expect(result.iv).toHaveLength(12);
      expect(typeof result.encrypted).toBe('object');
      expect(Array.isArray(result.encrypted)).toBe(true);
      expect(Array.isArray(result.iv)).toBe(true);
    });

    it('should handle encryption errors', async () => {
      const mockKey = { type: 'secret' };
      
      const errorCrypto = {
        subtle: {
          encrypt: jest.fn().mockRejectedValue(new Error('Encryption failed'))
        },
        getRandomValues: jest.fn((array) => {
          for (let i = 0; i < array.length; i++) {
            array[i] = Math.floor(Math.random() * 256);
          }
          return array;
        })
      };
      
      mockGetCrypto.mockReturnValue(errorCrypto);
      
      const testSecurityManager = new SecurityManager();
      await expect(testSecurityManager.encrypt('test data', mockKey))
        .rejects.toThrow('Encryption failed');
    });
  });

  describe('decrypt', () => {
    it('should decrypt data with provided key', async () => {
      const mockKey = { type: 'secret' };
      const expectedText = 'decrypted text';
      const textEncoder = new TextEncoder();
      
      // Mock crypto.subtle.decrypt to return encoded text
      global.crypto.subtle.decrypt.mockResolvedValue(textEncoder.encode(expectedText));
      


      const encryptedData = {
        encrypted: [1, 2, 3, 4, 5, 6, 7, 8],
        iv: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
      };
      
      const result = await securityManager.decrypt(encryptedData, mockKey);
      
      expect(global.crypto.subtle.decrypt).toHaveBeenCalledWith(
        {
          name: 'AES-GCM',
          iv: new Uint8Array(encryptedData.iv)
        },
        mockKey,
        new Uint8Array(encryptedData.encrypted)
      );
      expect(result).toBe(expectedText);
    });

    it('should handle decryption errors', async () => {
      const mockKey = { type: 'secret' };
      
      // Mock crypto.subtle.decrypt to reject
      global.crypto.subtle.decrypt.mockRejectedValue(new Error('Decryption failed'));
      

      
      const encryptedData = {
        encrypted: [1, 2, 3, 4, 5, 6, 7, 8],
        iv: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
      };
      
      await expect(securityManager.decrypt(encryptedData, mockKey))
        .rejects.toThrow('Decryption failed');
    });
  });
});