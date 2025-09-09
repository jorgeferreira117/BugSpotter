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
      } else {
        localStorage.setItem(key, JSON.stringify(item));
      }

      return true;
    } catch (error) {
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
      } else {
        const stored = localStorage.getItem(key);
        item = stored ? JSON.parse(stored) : null;
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
      } else {
        localStorage.removeItem(key);
      }
      return true;
    } catch (error) {
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
      } else {
        return Object.keys(localStorage);
      }
    } catch (error) {
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
      } else {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          const value = localStorage.getItem(key);
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

      for (const key of keys) {
        const item = await this.retrieve(key, storage);
        if (item === null) { // Item foi removido por estar expirado
          cleanedCount++;
        }
      }

      return cleanedCount;
    } catch (error) {
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
        let item;
        if (storage === 'chrome' && typeof chrome !== 'undefined' && chrome.storage) {
          const result = await chrome.storage.local.get([key]);
          item = result[key];
        } else {
          const stored = localStorage.getItem(key);
          item = stored ? JSON.parse(stored) : null;
        }

        if (item && item.timestamp) {
          items.push({ key, timestamp: item.timestamp, size: item.size || 0 });
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

      console.log('Manutenção do armazenamento concluída:', results);
      return results;
    } catch (error) {
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
      // Implementação simples de compressão (pode ser melhorada)
      return btoa(jsonString);
    } catch (error) {
      console.error('Erro na compressão:', error);
      return data;
    }
  }

  /**
   * Descomprime dados
   */
  decompress(compressedData) {
    try {
      const jsonString = atob(compressedData);
      return JSON.parse(jsonString);
    } catch (error) {
      console.error('Erro na descompressão:', error);
      return compressedData;
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

// Instância global do gerenciador de armazenamento
const storageManager = new StorageManager();

// Exportar para uso em outros módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
}