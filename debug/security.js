/**
 * Módulo de segurança para criptografia de dados sensíveis
 */

// Função para obter crypto de forma dinâmica
function getCrypto() {
  return typeof window !== 'undefined' ? window.crypto : global.crypto;
}

class SecurityManager {
  constructor() {
    this.algorithm = 'AES-GCM';
    this.keyLength = 256;
  }

  /**
   * Gera uma chave de criptografia
   */
  async generateKey() {
    return await getCrypto().subtle.generateKey(
      {
        name: this.algorithm,
        length: this.keyLength,
      },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Deriva uma chave a partir de uma senha
   */
  async deriveKey(password, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await getCrypto().subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    return await getCrypto().subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: this.algorithm, length: this.keyLength },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Criptografa dados
   */
  async encrypt(data, key) {
    const encoder = new TextEncoder();
    const iv = getCrypto().getRandomValues(new Uint8Array(12));
    
    const encrypted = await getCrypto().subtle.encrypt(
      {
        name: this.algorithm,
        iv: iv,
      },
      key,
      encoder.encode(data)
    );

    return {
      encrypted: Array.from(new Uint8Array(encrypted)),
      iv: Array.from(iv)
    };
  }

  /**
   * Descriptografa dados
   */
  async decrypt(encryptedData, key) {
    const decrypted = await getCrypto().subtle.decrypt(
      {
        name: this.algorithm,
        iv: new Uint8Array(encryptedData.iv),
      },
      key,
      new Uint8Array(encryptedData.encrypted)
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }

  /**
   * Gera um salt aleatório
   */
  generateSalt() {
    return getCrypto().getRandomValues(new Uint8Array(16));
  }

  /**
   * Armazena dados criptografados
   */
  async storeSecureData(key, data, password) {
    try {
      const salt = this.generateSalt();
      const cryptoKey = await this.deriveKey(password, salt);
      const encrypted = await this.encrypt(data, cryptoKey);
      
      await chrome.storage.local.set({
        [key]: {
          data: encrypted,
          salt: Array.from(salt),
          timestamp: Date.now()
        }
      });
      
      return true;
    } catch (error) {
      console.error('Erro ao armazenar dados seguros:', error);
      return false;
    }
  }

  /**
   * Recupera dados criptografados
   */
  async getSecureData(key, password) {
    try {
      const result = await chrome.storage.local.get([key]);
      if (!result[key]) {
        return null;
      }

      const { data, salt } = result[key];
      const cryptoKey = await this.deriveKey(password, new Uint8Array(salt));
      const decrypted = await this.decrypt(data, cryptoKey);
      
      return decrypted;
    } catch (error) {
      console.error('Erro ao recuperar dados seguros:', error);
      return null;
    }
  }

  /**
   * Remove dados seguros
   */
  async removeSecureData(key) {
    try {
      await chrome.storage.local.remove([key]);
      return true;
    } catch (error) {
      console.error('Erro ao remover dados seguros:', error);
      return false;
    }
  }

  /**
   * Valida se uma senha é forte
   */
  validatePassword(password) {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    
    return {
      isValid: password.length >= minLength && hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar,
      requirements: {
        minLength: password.length >= minLength,
        hasUpperCase,
        hasLowerCase,
        hasNumbers,
        hasSpecialChar
      }
    };
  }
}

// Instância global do gerenciador de segurança
const securityManager = new SecurityManager();

// Exportar para uso em outros módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SecurityManager;
  module.exports.getCrypto = getCrypto;
}