/**
 * Gerenciador otimizado de armazenamento
 */
class StorageManager {
  constructor() {
    this.maxStorageSize = 5 * 1024 * 1024; // 5MB
    this.maxItemAge = 7 * 24 * 60 * 60 * 1000; // 7 dias
    this.compressionThreshold = 1024; // 1KB
    this.cleanupInterval = null;
    this.init();
  }

  init() {
    // Limpeza automática a cada hora
    this.cleanupInterval = setInterval(() => {
      this.performMaintenance();
    }, 60 * 60 * 1000);
  }

  /**
   * Armazena dados com otimizações
   */
  async store(key, data, options = {}) {
    try {
      const {
        compress = true,
        ttl = this.maxItemAge,
        storage = 'chrome' // 'chrome' ou 'local'
      } = options;

      const item = {
        data: compress && this.shouldCompress(data) ? this.compress(data) : data,
        compressed: compress && this.shouldCompress(data),
        timestamp: Date.now(),
        ttl: ttl,
        size: this.calculateSize(data)
      };

      if (storage === 'chrome' && typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.set({ [key]: item });
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, JSON.stringify(item));
      } else {
        // Fallback para contexto de service worker
        // localStorage não disponível - silenciado
        await chrome.storage.local.set({ [key]: item });
      }

      return true;
    } catch (error) {
      // Verificar se é erro de contexto invalidado
      if (this.isExtensionContextInvalidated(error)) {
        console.warn('⚠️ Contexto da extensão invalidado - operação de armazenamento cancelada');
        return false;
      }
      
      console.error('Erro ao armazenar dados:', error);
      return false;
    }
  }

  /**
   * Recupera dados do armazenamento
   */
  async retrieve(key, storage = 'chrome') {
    try {
      let item;

      if (storage === 'chrome' && typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.local.get([key]);
        item = result[key];
      } else if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(key);
        if (stored && stored !== 'undefined' && stored !== 'null') {
          try {
            item = this.safeJsonParse(stored, key);
          } catch (parseError) {
            console.warn(`Erro ao parsear JSON para chave ${key}:: ${parseError.message}`);
            console.warn(`Dados corrompidos (primeiros 100 chars): ${stored.substring(0, 100)}`);
            // Remover item corrompido
            localStorage.removeItem(key);
            item = null;
          }
        } else {
          item = null;
        }
      } else {
        // Fallback para contexto de service worker
        // localStorage não disponível - silenciado
        const result = await chrome.storage.local.get([key]);
        item = result[key];
      }

      if (!item) {
        return null;
      }

      // Verificar se expirou
      if (this.isExpired(item)) {
        await this.remove(key, storage);
        return null;
      }

      // Descomprimir se necessário
      const data = item.compressed ? this.decompress(item.data) : item.data;
      return data;
    } catch (error) {
      // Verificar se é erro de contexto invalidado
      if (this.isExtensionContextInvalidated(error)) {
        console.warn('⚠️ Contexto da extensão invalidado - operação de recuperação cancelada');
        return null;
      }
      
      console.error('Erro ao recuperar dados:', error);
      return null;
    }
  }

  /**
   * Remove item do armazenamento
   */
  async remove(key, storage = 'chrome') {
    try {
      if (storage === 'chrome' && typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.remove([key]);
      } else if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
      } else {
        // Fallback para contexto de service worker
        // localStorage não disponível - silenciado
        await chrome.storage.local.remove([key]);
      }
      return true;
    } catch (error) {
      // Verificar se é erro de contexto invalidado
      if (this.isExtensionContextInvalidated(error)) {
        console.warn('⚠️ Contexto da extensão invalidado - operação de remoção cancelada');
        return false;
      }
      
      console.error('Erro ao remover dados:', error);
      return false;
    }
  }

  /**
   * Lista todas as chaves armazenadas
   */
  async listKeys(storage = 'chrome') {
    try {
      if (storage === 'chrome' && typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.local.get(null);
        return Object.keys(result);
      } else if (typeof localStorage !== 'undefined') {
        return Object.keys(localStorage);
      } else {
        // Fallback para contexto de service worker
        // localStorage não disponível - silenciado
        const result = await chrome.storage.local.get(null);
        return Object.keys(result);
      }
    } catch (error) {
      // Verificar se é erro de contexto invalidado
      if (this.isExtensionContextInvalidated(error)) {
        console.warn('⚠️ Contexto da extensão invalidado - operação de listagem cancelada');
        // Retornar array vazio para evitar quebrar o fluxo
        return [];
      }
      
      console.error('Erro ao listar chaves:', error);
      return [];
    }
  }

  /**
   * Calcula o uso atual do armazenamento
   */
  async getStorageUsage(storage = 'chrome') {
    try {
      let totalSize = 0;
      let itemCount = 0;

      if (storage === 'chrome' && typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.local.get(null);
        for (const [key, value] of Object.entries(result)) {
          totalSize += this.calculateSize(value);
          itemCount++;
        }
      } else if (typeof localStorage !== 'undefined') {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          const value = localStorage.getItem(key);
          totalSize += this.calculateSize(value);
          itemCount++;
        }
      } else {
        // Fallback para contexto de service worker
        console.warn('localStorage não disponível, usando chrome.storage.local como fallback');
        const result = await chrome.storage.local.get(null);
        for (const [key, value] of Object.entries(result)) {
          totalSize += this.calculateSize(value);
          itemCount++;
        }
      }

      return {
        totalSize,
        itemCount,
        usagePercentage: (totalSize / this.maxStorageSize) * 100
      };
    } catch (error) {
      // Verificar se é erro de contexto invalidado
      if (this.isExtensionContextInvalidated(error)) {
        console.warn('⚠️ Contexto da extensão invalidado - cálculo de uso cancelado');
        return { totalSize: 0, itemCount: 0, usagePercentage: 0 };
      }
      
      console.error('Erro ao calcular uso do armazenamento:', error);
      return { totalSize: 0, itemCount: 0, usagePercentage: 0 };
    }
  }

  /**
   * Limpa itens expirados
   */
  async cleanupExpiredItems(storage = 'chrome') {
    try {
      const keys = await this.listKeys(storage);
      let cleanedCount = 0;
      let errorCount = 0;

      for (const key of keys) {
        try {
          const item = await this.retrieve(key, storage);
          if (item === null) { // Item foi removido por estar expirado ou corrompido
            cleanedCount++;
          }
        } catch (itemError) {
          // Erro ao processar item específico - continuar com os outros
          console.warn(`Erro ao processar item ${key} durante limpeza:`, itemError.message);
          errorCount++;
          
          // Tentar remover item problemático diretamente
          try {
            await this.remove(key, storage);
            cleanedCount++;
          } catch (removeError) {
            console.error(`Falha ao remover item corrompido ${key}:`, removeError.message);
          }
        }
      }

      if (errorCount > 0) {
        console.warn(`Limpeza concluída com ${errorCount} erros. ${cleanedCount} itens removidos.`);
      }

      return cleanedCount;
    } catch (error) {
      // Verificar se é erro de contexto invalidado
      if (this.isExtensionContextInvalidated(error)) {
        console.warn('⚠️ Contexto da extensão invalidado - limpeza de itens expirados cancelada');
        return 0;
      }
      
      console.error('Erro na limpeza de itens expirados:', error);
      return 0;
    }
  }

  /**
   * Limpa itens mais antigos quando o armazenamento está cheio
   */
  async cleanupOldestItems(storage = 'chrome', targetPercentage = 70) {
    try {
      const usage = await this.getStorageUsage(storage);
      
      if (usage.usagePercentage <= targetPercentage) {
        return 0;
      }

      const keys = await this.listKeys(storage);
      const items = [];

      // Coletar todos os itens com timestamps
      for (const key of keys) {
        try {
          let item;
          if (storage === 'chrome' && typeof chrome !== 'undefined' && chrome.storage) {
            const result = await chrome.storage.local.get([key]);
            item = result[key];
          } else if (typeof localStorage !== 'undefined') {
            const stored = localStorage.getItem(key);
            if (stored && stored !== 'undefined' && stored !== 'null') {
               try {
                 item = this.safeJsonParse(stored, key);
               } catch (parseError) {
                 console.warn(`Item corrompido encontrado durante cleanup: ${key}`);
                 // Remover item corrompido
                 localStorage.removeItem(key);
                 item = null;
               }
            } else {
              item = null;
            }
          } else {
            // Fallback para contexto de service worker
            // localStorage não disponível - silenciado
            const result = await chrome.storage.local.get([key]);
            item = result[key];
          }

          if (item && item.timestamp) {
            items.push({ key, timestamp: item.timestamp, size: item.size || 0 });
          }
        } catch (itemError) {
          console.warn(`Erro ao processar item ${key} durante coleta:`, itemError.message);
          // Tentar remover item problemático
          try {
            await this.remove(key, storage);
          } catch (removeError) {
            console.error(`Falha ao remover item corrompido ${key}:`, removeError.message);
          }
        }
      }

      // Ordenar por timestamp (mais antigos primeiro)
      items.sort((a, b) => a.timestamp - b.timestamp);

      let removedCount = 0;
      let removedSize = 0;
      const targetSize = this.maxStorageSize * (targetPercentage / 100);

      for (const item of items) {
        if (usage.totalSize - removedSize <= targetSize) {
          break;
        }

        await this.remove(item.key, storage);
        removedSize += item.size;
        removedCount++;
      }

      return removedCount;
    } catch (error) {
      // Verificar se é erro de contexto invalidado
      if (this.isExtensionContextInvalidated(error)) {
        console.warn('⚠️ Contexto da extensão invalidado - limpeza de itens antigos cancelada');
        return 0;
      }
      
      console.error('Erro na limpeza de itens antigos:', error);
      return 0;
    }
  }

  /**
   * Executa manutenção completa do armazenamento
   */
  async performMaintenance() {
    try {
      const results = {
        chrome: { expired: 0, oldest: 0 },
        local: { expired: 0, oldest: 0 }
      };

      // Limpeza do chrome.storage
      if (typeof chrome !== 'undefined' && chrome.storage) {
        results.chrome.expired = await this.cleanupExpiredItems('chrome');
        results.chrome.oldest = await this.cleanupOldestItems('chrome');
      }

      // Limpeza do localStorage
      results.local.expired = await this.cleanupExpiredItems('local');
      results.local.oldest = await this.cleanupOldestItems('local');

      // Manutenção do armazenamento concluída - silenciado
      return results;
    } catch (error) {
      // Verificar se é erro de contexto invalidado
      if (this.isExtensionContextInvalidated(error)) {
        console.warn('⚠️ Contexto da extensão invalidado - manutenção do armazenamento cancelada');
        return null;
      }
      
      console.error('Erro na manutenção do armazenamento:', error);
      return null;
    }
  }

  /**
   * Comprime dados usando algoritmo simples
   */
  compress(data) {
    try {
      const jsonString = JSON.stringify(data);
      
      // Verificar se a string é muito grande para compressão
      if (jsonString.length > 1000000) { // 1MB
        // Dados muito grandes para compressão - silenciado
        return jsonString;
      }
      
      // Codificar para UTF-8 antes de usar btoa para evitar DOMException
      const utf8Bytes = new TextEncoder().encode(jsonString);
      const binaryString = Array.from(utf8Bytes, byte => String.fromCharCode(byte)).join('');
      return btoa(binaryString);
    } catch (error) {
      // Silenciar erro para evitar spam no console
      // console.error('Erro na compressão:', error);
      // Retornar dados originais em caso de erro
      return JSON.stringify(data);
    }
  }

  /**
   * Descomprime dados
   */
  decompress(compressedData) {
    // Verificar se os dados são válidos para base64
    if (!compressedData || typeof compressedData !== 'string') {
      console.warn('Dados inválidos para descompressão:', compressedData);
      return compressedData;
    }

    // Verificar se é uma string base64 válida
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(compressedData)) {
      console.warn('Dados não estão em formato base64 válido, retornando como estão:', compressedData);
      // Se não é base64, pode ser JSON não comprimido
      try {
        return JSON.parse(compressedData);
      } catch (parseError) {
        return compressedData;
      }
    }

    try {
      const binaryString = atob(compressedData);
      // Decodificar de UTF-8
      const utf8Bytes = new Uint8Array(Array.from(binaryString, char => char.charCodeAt(0)));
      const jsonString = new TextDecoder().decode(utf8Bytes);
      return JSON.parse(jsonString);
    } catch (error) {
      // Fallback para método antigo (compatibilidade)
      try {
        const jsonString = atob(compressedData);
        return JSON.parse(jsonString);
      } catch (fallbackError) {
        console.error('Erro na descompressão (ambos os métodos falharam):', error, fallbackError);
        // Tentar retornar como JSON não comprimido
        try {
          return JSON.parse(compressedData);
        } catch (finalError) {
          console.warn('Retornando dados originais sem processamento');
          return compressedData;
        }
      }
    }
  }

  /**
   * Verifica se dados devem ser comprimidos
   */
  shouldCompress(data) {
    const size = this.calculateSize(data);
    return size > this.compressionThreshold;
  }

  /**
   * Calcula o tamanho dos dados em bytes
   */
  calculateSize(data) {
    try {
      const jsonString = JSON.stringify(data);
      return new Blob([jsonString]).size;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Parsing seguro de JSON com validação
   */
  safeJsonParse(jsonString, key = 'unknown') {
    if (!jsonString || typeof jsonString !== 'string' || jsonString.trim() === '') {
      throw new Error('Dados inválidos: não é uma string válida');
    }
    
    const trimmed = jsonString.trim();
    
    // Verificar se começa com caracteres válidos de JSON
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && !trimmed.startsWith('"')) {
      // Pode ser um valor primitivo ou dados corrompidos
      if (!/^(true|false|null|\d+(\.\d+)?|".*")$/.test(trimmed)) {
        throw new Error(`Dados malformados detectados: ${trimmed.substring(0, 50)}...`);
      }
    }
    
    try {
      return JSON.parse(jsonString);
    } catch (parseError) {
      throw new Error(`Erro de parsing JSON para chave ${key}: ${parseError.message}`);
    }
  }

  /**
   * Verifica se o erro é de contexto de extensão invalidado
   */
  isExtensionContextInvalidated(error) {
    return error && error.message && error.message.includes('Extension context invalidated');
  }

  /**
   * Verifica se um item expirou
   */
  isExpired(item) {
    if (!item.timestamp || !item.ttl) {
      return false;
    }
    return (Date.now() - item.timestamp) > item.ttl;
  }

  /**
   * Gera relatório de uso do armazenamento
   */
  async generateStorageReport() {
    const chromeUsage = await this.getStorageUsage('chrome');
    const localUsage = await this.getStorageUsage('local');

    return {
      timestamp: new Date().toISOString(),
      chrome: chromeUsage,
      local: localUsage,
      total: {
        totalSize: chromeUsage.totalSize + localUsage.totalSize,
        itemCount: chromeUsage.itemCount + localUsage.itemCount
      }
    };
  }

  /**
   * Detecta e reporta dados corrompidos no storage
   */
  async detectCorruptedData(storage = 'chrome') {
    const report = {
      totalKeys: 0,
      corruptedKeys: [],
      validKeys: 0,
      errors: []
    };

    try {
      const keys = await this.listKeys(storage);
      report.totalKeys = keys.length;

      for (const key of keys) {
        try {
          if (storage === 'chrome' && typeof chrome !== 'undefined' && chrome.storage) {
            const result = await chrome.storage.local.get([key]);
            const item = result[key];
            if (item) {
              report.validKeys++;
            }
          } else if (typeof localStorage !== 'undefined') {
            const stored = localStorage.getItem(key);
            if (stored && stored !== 'undefined' && stored !== 'null') {
              try {
                this.safeJsonParse(stored, key);
                report.validKeys++;
              } catch (parseError) {
                report.corruptedKeys.push({
                  key,
                  error: parseError.message,
                  preview: stored.substring(0, 100)
                });
              }
            }
          }
        } catch (error) {
          report.errors.push({
            key,
            error: error.message
          });
        }
      }

      return report;
    } catch (error) {
      console.error('Erro ao detectar dados corrompidos:', error);
      return null;
    }
  }

  /**
   * Alias para performMaintenance - usado pelo background.js
   */
  async cleanup(aggressive = false) {
    if (aggressive) {
      // Limpeza mais agressiva - reduzir TTL temporariamente
      const originalMaxAge = this.maxItemAge;
      this.maxItemAge = 3 * 24 * 60 * 60 * 1000; // 3 dias ao invés de 7
      
      const result = await this.performMaintenance();
      
      // Restaurar TTL original
      this.maxItemAge = originalMaxAge;
      
      return result;
    }
    
    return await this.performMaintenance();
  }

  /**
   * Alias para generateStorageReport - usado pelo background.js
   */
  async generateReport() {
    const report = await this.generateStorageReport();
    
    // Adicionar campo usage para compatibilidade
    if (report && report.chrome) {
      const maxSize = this.maxStorageSize;
      const currentSize = report.chrome.totalSize || 0;
      report.usage = currentSize / maxSize;
    }
    
    return report;
  }

  /**
   * Cleanup ao destruir a instância
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Exportar apenas a classe, sem instanciar automaticamente
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
} else if (typeof window !== 'undefined') {
  window.StorageManager = StorageManager;
}