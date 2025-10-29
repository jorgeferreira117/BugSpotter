/**
 * StorageInterface - Interface Unificada de Storage
 * Consolida StorageManager, IndexedDBManager e StorageBuckets
 * Fornece uma API única para todas as operações de armazenamento
 */

class StorageInterface {
  constructor() {
    this.storageManager = null;
    this.indexedDBManager = null;
    this.storageBuckets = null;
    this.initialized = false;
    this.initPromise = null;
  }

  /**
   * Inicializa todos os gerenciadores de storage
   */
  async init() {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._performInit();
    return this.initPromise;
  }

  async _performInit() {
    try {
      // Inicializar StorageManager se disponível
      if (typeof StorageManager !== 'undefined') {
        this.storageManager = new StorageManager();
        await this.storageManager.init();
      }

      // Inicializar IndexedDBManager se disponível
      if (typeof IndexedDBManager !== 'undefined') {
        this.indexedDBManager = new IndexedDBManager();
        await this.indexedDBManager.init();
      }

      // Inicializar StorageBuckets se disponível
      if (typeof StorageBuckets !== 'undefined') {
        this.storageBuckets = new StorageBuckets();
        await this.storageBuckets.init();
      }

      this.initialized = true;
      console.log('[StorageInterface] Initialized successfully');
    } catch (error) {
      console.error('[StorageInterface] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Garante que o storage está inicializado
   */
  async _ensureInitialized() {
    if (!this.initialized) {
      await this.init();
    }
  }

  // ==================== OPERAÇÕES BÁSICAS ====================

  /**
   * Armazena dados usando a estratégia mais apropriada
   * @param {string} key - Chave para armazenamento
   * @param {*} data - Dados a serem armazenados
   * @param {Object} options - Opções de armazenamento
   * @param {string} options.type - Tipo de storage ('local', 'session', 'indexed', 'bucket')
   * @param {string} options.bucket - Nome do bucket (para storage buckets)
   * @param {number} options.ttl - Time to live em segundos
   * @param {boolean} options.encrypt - Se deve criptografar os dados
   */
  async set(key, data, options = {}) {
    await this._ensureInitialized();

    const { type = 'auto', bucket, ttl, encrypt = false } = options;

    try {
      // Determinar estratégia de storage automaticamente
      const storageType = type === 'auto' ? this._determineStorageType(key, data) : type;

      switch (storageType) {
        case 'indexed':
          if (this.indexedDBManager) {
            return await this.indexedDBManager.set(key, data, { ttl, encrypt });
          }
          // Fallback para chrome.storage
          return await this._setChromeStorage(key, data, 'local');

        case 'bucket':
          if (this.storageBuckets && bucket) {
            return await this.storageBuckets.set(bucket, key, data, { ttl, encrypt });
          }
          // Fallback para storage manager
          return await this._setStorageManager(key, data, { ttl, encrypt });

        case 'session':
          return await this._setChromeStorage(key, data, 'session');

        case 'local':
        default:
          return await this._setChromeStorage(key, data, 'local');
      }
    } catch (error) {
      console.error(`[StorageInterface] Error setting ${key}:`, error);
      throw error;
    }
  }

  /**
   * Recupera dados do storage
   * @param {string} key - Chave dos dados
   * @param {Object} options - Opções de recuperação
   * @param {string} options.type - Tipo de storage
   * @param {string} options.bucket - Nome do bucket
   * @param {*} options.defaultValue - Valor padrão se não encontrado
   */
  async get(key, options = {}) {
    await this._ensureInitialized();

    const { type = 'auto', bucket, defaultValue = null } = options;

    try {
      // Tentar diferentes estratégias se type for 'auto'
      if (type === 'auto') {
        return await this._getAuto(key, defaultValue);
      }

      switch (type) {
        case 'indexed':
          if (this.indexedDBManager) {
            return await this.indexedDBManager.get(key, defaultValue);
          }
          break;

        case 'bucket':
          if (this.storageBuckets && bucket) {
            return await this.storageBuckets.get(bucket, key, defaultValue);
          }
          break;

        case 'session':
          return await this._getChromeStorage(key, 'session', defaultValue);

        case 'local':
        default:
          return await this._getChromeStorage(key, 'local', defaultValue);
      }

      return defaultValue;
    } catch (error) {
      console.error(`[StorageInterface] Error getting ${key}:`, error);
      return defaultValue;
    }
  }

  /**
   * Remove dados do storage
   * @param {string} key - Chave a ser removida
   * @param {Object} options - Opções de remoção
   */
  async remove(key, options = {}) {
    await this._ensureInitialized();

    const { type = 'auto', bucket } = options;

    try {
      if (type === 'auto') {
        // Tentar remover de todos os storages
        const promises = [];

        if (this.indexedDBManager) {
          promises.push(this.indexedDBManager.remove(key).catch(() => {}));
        }

        if (this.storageBuckets && bucket) {
          promises.push(this.storageBuckets.remove(bucket, key).catch(() => {}));
        }

        promises.push(this._removeChromeStorage(key, 'local').catch(() => {}));
        promises.push(this._removeChromeStorage(key, 'session').catch(() => {}));

        await Promise.all(promises);
        return true;
      }

      switch (type) {
        case 'indexed':
          if (this.indexedDBManager) {
            return await this.indexedDBManager.remove(key);
          }
          break;

        case 'bucket':
          if (this.storageBuckets && bucket) {
            return await this.storageBuckets.remove(bucket, key);
          }
          break;

        case 'session':
          return await this._removeChromeStorage(key, 'session');

        case 'local':
        default:
          return await this._removeChromeStorage(key, 'local');
      }

      return false;
    } catch (error) {
      console.error(`[StorageInterface] Error removing ${key}:`, error);
      return false;
    }
  }

  // ==================== OPERAÇÕES ESPECIALIZADAS ====================

  /**
   * Armazena configurações da extensão
   */
  async setSettings(settings) {
    return await this.set('settings', settings, {
      type: 'local',
      encrypt: true
    });
  }

  /**
   * Recupera configurações da extensão
   */
  async getSettings(defaultSettings = {}) {
    return await this.get('settings', {
      type: 'local',
      defaultValue: defaultSettings
    });
  }

  /**
   * Armazena relatório de bug
   */
  async saveBugReport(report) {
    const reportId = report.id || `bug_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return await this.set(`bug_report_${reportId}`, report, {
      type: 'indexed',
      encrypt: true
    });
  }

  /**
   * Recupera relatórios de bug
   */
  async getBugReports(limit = 50) {
    if (this.indexedDBManager) {
      return await this.indexedDBManager.getByPrefix('bug_report_', limit);
    }

    // Fallback para chrome.storage
    const result = await chrome.storage.local.get(null);
    const reports = [];
    
    Object.entries(result).forEach(([key, value]) => {
      if (key.startsWith('bug_report_')) {
        reports.push(value);
      }
    });

    return reports.slice(0, limit);
  }

  /**
   * Armazena relatório de IA
   */
  async saveAIReport(report) {
    const reportId = report.id || `ai_report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return await this.set(`ai_report_${reportId}`, report, {
      type: 'bucket',
      bucket: 'ai_reports',
      ttl: 30 * 24 * 60 * 60 // 30 dias
    });
  }

  /**
   * Recupera relatórios de IA
   */
  async getAIReports(limit = 20) {
    if (this.storageBuckets) {
      return await this.storageBuckets.getAll('ai_reports', limit);
    }

    // Fallback
    const result = await chrome.storage.local.get(null);
    const reports = [];
    
    Object.entries(result).forEach(([key, value]) => {
      if (key.startsWith('ai_report_')) {
        reports.push(value);
      }
    });

    return reports.slice(0, limit);
  }

  /**
   * Armazena dados de sessão temporários
   */
  async setSessionData(key, data, ttl = 3600) {
    return await this.set(key, data, {
      type: 'session',
      ttl
    });
  }

  /**
   * Recupera dados de sessão
   */
  async getSessionData(key, defaultValue = null) {
    return await this.get(key, {
      type: 'session',
      defaultValue
    });
  }

  // ==================== OPERAÇÕES DE LIMPEZA ====================

  /**
   * Limpa dados expirados de todos os storages
   */
  async cleanupExpiredData() {
    const promises = [];

    if (this.indexedDBManager && typeof this.indexedDBManager.cleanup === 'function') {
      promises.push(this.indexedDBManager.cleanup());
    }

    if (this.storageBuckets && typeof this.storageBuckets.cleanup === 'function') {
      promises.push(this.storageBuckets.cleanup());
    }

    if (this.storageManager && typeof this.storageManager.cleanup === 'function') {
      promises.push(this.storageManager.cleanup());
    }

    await Promise.all(promises);
  }

  /**
   * Limpa todos os dados (para reset da extensão)
   */
  async clearAllData() {
    const promises = [];

    // Limpar IndexedDB
    if (this.indexedDBManager && typeof this.indexedDBManager.clear === 'function') {
      promises.push(this.indexedDBManager.clear());
    }

    // Limpar Storage Buckets
    if (this.storageBuckets && typeof this.storageBuckets.clearAll === 'function') {
      promises.push(this.storageBuckets.clearAll());
    }

    // Limpar Chrome Storage
    promises.push(chrome.storage.local.clear());
    promises.push(chrome.storage.session.clear());

    await Promise.all(promises);
  }

  // ==================== MÉTODOS PRIVADOS ====================

  /**
   * Determina o tipo de storage mais apropriado baseado na chave e dados
   */
  _determineStorageType(key, data) {
    // Dados grandes ou binários -> IndexedDB
    if (this._isLargeData(data) || this._isBinaryData(data)) {
      return 'indexed';
    }

    // Dados temporários -> Session Storage
    if (key.includes('temp_') || key.includes('session_')) {
      return 'session';
    }

    // Relatórios de IA -> Buckets (com TTL)
    if (key.startsWith('ai_report_')) {
      return 'bucket';
    }

    // Padrão -> Local Storage
    return 'local';
  }

  /**
   * Verifica se os dados são grandes (> 1MB)
   */
  _isLargeData(data) {
    try {
      const size = JSON.stringify(data).length;
      return size > 1024 * 1024; // 1MB
    } catch {
      return false;
    }
  }

  /**
   * Verifica se os dados são binários
   */
  _isBinaryData(data) {
    return data instanceof ArrayBuffer || 
           data instanceof Uint8Array || 
           (typeof data === 'string' && data.startsWith('data:'));
  }

  /**
   * Recupera dados automaticamente tentando diferentes storages
   */
  async _getAuto(key, defaultValue) {
    // Tentar IndexedDB primeiro (para dados grandes)
    if (this.indexedDBManager) {
      try {
        const result = await this.indexedDBManager.get(key);
        if (result !== null && result !== undefined) {
          return result;
        }
      } catch (error) {
        console.warn(`[StorageInterface] IndexedDB get failed for ${key}:`, error);
      }
    }

    // Tentar Storage Buckets
    if (this.storageBuckets) {
      try {
        // Tentar buckets comuns
        const buckets = ['ai_reports', 'bug_reports', 'temp_data'];
        for (const bucket of buckets) {
          const result = await this.storageBuckets.get(bucket, key);
          if (result !== null && result !== undefined) {
            return result;
          }
        }
      } catch (error) {
        console.warn(`[StorageInterface] StorageBuckets get failed for ${key}:`, error);
      }
    }

    // Tentar Chrome Storage Local
    try {
      const result = await this._getChromeStorage(key, 'local');
      if (result !== null && result !== undefined) {
        return result;
      }
    } catch (error) {
      console.warn(`[StorageInterface] Chrome local storage get failed for ${key}:`, error);
    }

    // Tentar Chrome Storage Session
    try {
      const result = await this._getChromeStorage(key, 'session');
      if (result !== null && result !== undefined) {
        return result;
      }
    } catch (error) {
      console.warn(`[StorageInterface] Chrome session storage get failed for ${key}:`, error);
    }

    return defaultValue;
  }

  /**
   * Operações Chrome Storage
   */
  async _setChromeStorage(key, data, type = 'local') {
    const storage = type === 'session' ? chrome.storage.session : chrome.storage.local;
    await storage.set({ [key]: data });
    return true;
  }

  async _getChromeStorage(key, type = 'local', defaultValue = null) {
    const storage = type === 'session' ? chrome.storage.session : chrome.storage.local;
    const result = await storage.get([key]);
    return result[key] !== undefined ? result[key] : defaultValue;
  }

  async _removeChromeStorage(key, type = 'local') {
    const storage = type === 'session' ? chrome.storage.session : chrome.storage.local;
    await storage.remove([key]);
    return true;
  }

  /**
   * Operações Storage Manager
   */
  async _setStorageManager(key, data, options = {}) {
    if (this.storageManager) {
      return await this.storageManager.set(key, data, options);
    }
    return await this._setChromeStorage(key, data, 'local');
  }

  // ==================== MÉTODOS DE UTILIDADE ====================

  /**
   * Obtém estatísticas de uso do storage
   */
  async getStorageStats() {
    const stats = {
      local: { used: 0, available: 0 },
      session: { used: 0, available: 0 },
      indexed: { used: 0, available: 0 },
      buckets: { used: 0, available: 0 }
    };

    try {
      // Chrome Storage stats
      if (chrome.storage.local.getBytesInUse) {
        stats.local.used = await chrome.storage.local.getBytesInUse();
        stats.local.available = chrome.storage.local.QUOTA_BYTES - stats.local.used;
      }

      if (chrome.storage.session.getBytesInUse) {
        stats.session.used = await chrome.storage.session.getBytesInUse();
        stats.session.available = chrome.storage.session.QUOTA_BYTES - stats.session.used;
      }

      // IndexedDB stats
      if (this.indexedDBManager && typeof this.indexedDBManager.getStats === 'function') {
        const indexedStats = await this.indexedDBManager.getStats();
        stats.indexed = indexedStats;
      }

      // Storage Buckets stats
      if (this.storageBuckets && typeof this.storageBuckets.getStats === 'function') {
        const bucketStats = await this.storageBuckets.getStats();
        stats.buckets = bucketStats;
      }

    } catch (error) {
      console.error('[StorageInterface] Error getting storage stats:', error);
    }

    return stats;
  }

  /**
   * Exporta todos os dados para backup
   */
  async exportAllData() {
    const exportData = {
      timestamp: new Date().toISOString(),
      version: '1.0',
      data: {
        local: {},
        session: {},
        indexed: {},
        buckets: {}
      }
    };

    try {
      // Exportar Chrome Storage Local
      exportData.data.local = await chrome.storage.local.get(null);

      // Exportar Chrome Storage Session
      exportData.data.session = await chrome.storage.session.get(null);

      // Exportar IndexedDB
      if (this.indexedDBManager && typeof this.indexedDBManager.exportAll === 'function') {
        exportData.data.indexed = await this.indexedDBManager.exportAll();
      }

      // Exportar Storage Buckets
      if (this.storageBuckets && typeof this.storageBuckets.exportAll === 'function') {
        exportData.data.buckets = await this.storageBuckets.exportAll();
      }

    } catch (error) {
      console.error('[StorageInterface] Error exporting data:', error);
      throw error;
    }

    return exportData;
  }

  /**
   * Importa dados de backup
   */
  async importAllData(exportData) {
    try {
      if (exportData.data.local) {
        await chrome.storage.local.set(exportData.data.local);
      }

      if (exportData.data.session) {
        await chrome.storage.session.set(exportData.data.session);
      }

      if (exportData.data.indexed && this.indexedDBManager && 
          typeof this.indexedDBManager.importAll === 'function') {
        await this.indexedDBManager.importAll(exportData.data.indexed);
      }

      if (exportData.data.buckets && this.storageBuckets && 
          typeof this.storageBuckets.importAll === 'function') {
        await this.storageBuckets.importAll(exportData.data.buckets);
      }

      console.log('[StorageInterface] Data imported successfully');
      return true;

    } catch (error) {
      console.error('[StorageInterface] Error importing data:', error);
      throw error;
    }
  }
}

// Instância singleton
let storageInterfaceInstance = null;

/**
 * Obtém a instância singleton do StorageInterface
 */
function getStorageInterface() {
  if (!storageInterfaceInstance) {
    storageInterfaceInstance = new StorageInterface();
  }
  return storageInterfaceInstance;
}

// Exportar para uso global
if (typeof window !== 'undefined') {
  window.StorageInterface = StorageInterface;
  window.getStorageInterface = getStorageInterface;
}

// Exportar para módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StorageInterface, getStorageInterface };
}