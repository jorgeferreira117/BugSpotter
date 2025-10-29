/**
 * IndexedDBManager - Gerenciador de armazenamento IndexedDB para dados grandes
 * Usado como alternativa ao chrome.storage.local para vídeos e arquivos grandes
 */
class IndexedDBManager {
  constructor() {
    this.dbName = 'BugSpotterDB';
    this.dbVersion = 1;
    this.db = null;
    this.stores = {
      videos: 'videos',
      screenshots: 'screenshots',
      logs: 'logs',
      cache: 'cache'
    };
  }

  /**
   * Inicializa o banco de dados IndexedDB
   */
  async init() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        resolve(this.db);
        return;
      }

      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('❌ Erro ao abrir IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('✅ IndexedDB inicializado com sucesso');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Criar object stores se não existirem
        Object.values(this.stores).forEach(storeName => {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: 'id' });
            
            // Adicionar índices úteis
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.createIndex('size', 'size', { unique: false });
            store.createIndex('type', 'type', { unique: false });
            
            console.log(`📦 Object store '${storeName}' criado`);
          }
        });
      };
    });
  }

  /**
   * Armazena dados no IndexedDB
   */
  async store(storeName, key, data, metadata = {}) {
    try {
      await this.init();
      
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      
      const item = {
        id: key,
        data: data,
        timestamp: Date.now(),
        size: this.calculateSize(data),
        type: metadata.type || 'unknown',
        compressed: metadata.compressed || false,
        ttl: metadata.ttl || null,
        ...metadata
      };
      
      const request = store.put(item);
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          console.log(`💾 Dados armazenados no IndexedDB: ${key} (${this.formatSize(item.size)})`);
          resolve(true);
        };
        
        request.onerror = () => {
          console.error('❌ Erro ao armazenar no IndexedDB:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('❌ Erro no IndexedDBManager.store:', error);
      throw error;
    }
  }

  /**
   * Recupera dados do IndexedDB
   */
  async retrieve(storeName, key) {
    try {
      await this.init();
      
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          const item = request.result;
          
          if (!item) {
            resolve(null);
            return;
          }
          
          // Verificar se expirou
          if (item.ttl && Date.now() > item.timestamp + item.ttl) {
            console.log(`⏰ Item expirado removido: ${key}`);
            this.remove(storeName, key);
            resolve(null);
            return;
          }
          
          console.log(`📥 Dados recuperados do IndexedDB: ${key} (${this.formatSize(item.size)})`);
          resolve(item.data);
        };
        
        request.onerror = () => {
          console.error('❌ Erro ao recuperar do IndexedDB:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('❌ Erro no IndexedDBManager.retrieve:', error);
      return null;
    }
  }

  /**
   * Remove item do IndexedDB
   */
  async remove(storeName, key) {
    try {
      await this.init();
      
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          console.log(`🗑️ Item removido do IndexedDB: ${key}`);
          resolve(true);
        };
        
        request.onerror = () => {
          console.error('❌ Erro ao remover do IndexedDB:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('❌ Erro no IndexedDBManager.remove:', error);
      return false;
    }
  }

  /**
   * Lista todas as chaves de um store
   */
  async listKeys(storeName) {
    try {
      await this.init();
      
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAllKeys();
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          resolve(request.result);
        };
        
        request.onerror = () => {
          console.error('❌ Erro ao listar chaves do IndexedDB:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('❌ Erro no IndexedDBManager.listKeys:', error);
      return [];
    }
  }

  /**
   * Obtém estatísticas de uso do IndexedDB
   */
  async getUsageStats() {
    try {
      await this.init();
      
      const stats = {
        stores: {},
        totalSize: 0,
        totalItems: 0
      };
      
      for (const storeName of Object.values(this.stores)) {
        const transaction = this.db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        
        await new Promise((resolve, reject) => {
          request.onsuccess = () => {
            const items = request.result;
            let storeSize = 0;
            
            items.forEach(item => {
              storeSize += item.size || 0;
            });
            
            stats.stores[storeName] = {
              itemCount: items.length,
              size: storeSize,
              formattedSize: this.formatSize(storeSize)
            };
            
            stats.totalSize += storeSize;
            stats.totalItems += items.length;
            
            resolve();
          };
          
          request.onerror = () => {
            console.error(`❌ Erro ao obter stats do store ${storeName}:`, request.error);
            reject(request.error);
          };
        });
      }
      
      stats.formattedTotalSize = this.formatSize(stats.totalSize);
      
      return stats;
    } catch (error) {
      console.error('❌ Erro ao obter estatísticas do IndexedDB:', error);
      return null;
    }
  }

  /**
   * Limpa itens expirados de todos os stores
   */
  async cleanupExpired() {
    try {
      await this.init();
      
      let totalCleaned = 0;
      const now = Date.now();
      
      for (const storeName of Object.values(this.stores)) {
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        
        await new Promise((resolve, reject) => {
          request.onsuccess = () => {
            const items = request.result;
            let cleanedInStore = 0;
            
            items.forEach(item => {
              if (item.ttl && now > item.timestamp + item.ttl) {
                store.delete(item.id);
                cleanedInStore++;
              }
            });
            
            totalCleaned += cleanedInStore;
            console.log(`🧹 ${cleanedInStore} itens expirados removidos do store '${storeName}'`);
            resolve();
          };
          
          request.onerror = () => {
            console.error(`❌ Erro na limpeza do store ${storeName}:`, request.error);
            reject(request.error);
          };
        });
      }
      
      console.log(`✅ Limpeza concluída: ${totalCleaned} itens removidos`);
      return totalCleaned;
    } catch (error) {
      console.error('❌ Erro na limpeza do IndexedDB:', error);
      return 0;
    }
  }

  /**
   * Limpa itens mais antigos quando necessário
   */
  async cleanupOldest(storeName, keepCount = 10) {
    try {
      await this.init();
      
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const index = store.index('timestamp');
      const request = index.getAll();
      
      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          const items = request.result.sort((a, b) => b.timestamp - a.timestamp);
          
          if (items.length <= keepCount) {
            resolve(0);
            return;
          }
          
          const toRemove = items.slice(keepCount);
          let removed = 0;
          
          toRemove.forEach(item => {
            store.delete(item.id);
            removed++;
          });
          
          console.log(`🧹 ${removed} itens antigos removidos do store '${storeName}'`);
          resolve(removed);
        };
        
        request.onerror = () => {
          console.error(`❌ Erro na limpeza de itens antigos do store ${storeName}:`, request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('❌ Erro na limpeza de itens antigos:', error);
      return 0;
    }
  }

  /**
   * Calcula o tamanho aproximado dos dados
   */
  calculateSize(data) {
    try {
      if (data instanceof Blob) {
        return data.size;
      }
      if (data instanceof ArrayBuffer) {
        return data.byteLength;
      }
      return JSON.stringify(data).length * 2; // Aproximação para UTF-16
    } catch (error) {
      console.warn('⚠️ Erro ao calcular tamanho:', error);
      return 0;
    }
  }

  /**
   * Formata tamanho em bytes para formato legível
   */
  formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Fecha a conexão com o banco
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('🔒 Conexão IndexedDB fechada');
    }
  }
}

// Exportar para uso global
if (typeof window !== 'undefined') {
  window.IndexedDBManager = IndexedDBManager;
}

// Exportar para módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = IndexedDBManager;
}