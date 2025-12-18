/**
 * Gerenciador otimizado de armazenamento
 */
class StorageManager {
  constructor() {
    this.maxStorageSize = 5 * 1024 * 1024; // 5MB
    this.maxItemAge = 7 * 24 * 60 * 60 * 1000; // 7 dias
    this.compressionThreshold = 1024; // 1KB
    this.cleanupInterval = null;
    this._contextInvalidated = false; // Flag para contexto invalidado
    this.lastMaintenance = 0; // Controle de throttling para manutenção
    
    // Configurações para IndexedDB
    this.compressionEnabled = true;
    this.maxRetries = 3;
    this.retryDelay = 1000;
    this.quotaThreshold = 0.8; // 80% da quota
    this.emergencyCleanupThreshold = 0.95; // 95% da quota
    this.cleanupBatchSize = 10;
    this.debugMode = false;
    
    // Limites para usar IndexedDB vs chrome.storage.local
    this.largeDataThreshold = 1024 * 1024; // 1MB
    this.indexedDBManager = null;
    
    // Configurações de compressão de vídeo
    this.videoCompressionEnabled = true;
    this.videoCompressionLevel = 'medium'; // low, medium, high, ultra
    this.videoCompressor = null;
    
    // Configurações para StorageBuckets
    this.storageBuckets = null;
    this.useStorageBuckets = true;
    
    // Configuração unificada
    this.config = {
      maxChromeStorageSize: 10 * 1024 * 1024, // 10MB limit for chrome.storage.local
      useIndexedDBFallback: true,
      useStorageBuckets: true,
      videoCompressionEnabled: true,
      videoCompressionLevel: 'medium' // low, medium, high, ultra
    };
    
    this.init();
    this.initIndexedDB();
    this.initVideoCompressor();
    this.initStorageBuckets();
  }

  init() {
    // Limpeza automática a cada hora
    this.cleanupInterval = setInterval(() => {
      this.performMaintenance();
    }, 60 * 60 * 1000);
  }

  /**
   * Inicializa o IndexedDBManager para dados grandes
   */
  async initIndexedDB() {
    try {
      // Importar dinamicamente o IndexedDBManager
      if (typeof window !== 'undefined' && window.IndexedDBManager) {
        this.indexedDBManager = new window.IndexedDBManager();
        await this.indexedDBManager.init();
        console.log('IndexedDBManager inicializado com sucesso');
      } else {
        // Tentar carregar o módulo
        const script = document.createElement('script');
        script.src = '../modules/IndexedDBManager.js';
        script.onload = async () => {
          this.indexedDBManager = new window.IndexedDBManager();
          await this.indexedDBManager.init();
          console.log('IndexedDBManager carregado e inicializado');
        };
        document.head.appendChild(script);
      }
    } catch (error) {
      console.log('⚠️ IndexedDB não disponível, usando apenas chrome.storage.local:', error);
    }
  }

  /**
   * Inicializa o VideoCompressor para compressão de vídeos
   */
  async initVideoCompressor() {
    try {
      // Importar dinamicamente o VideoCompressor
      if (typeof window !== 'undefined' && window.VideoCompressor) {
        this.videoCompressor = new window.VideoCompressor();
        console.log('VideoCompressor inicializado com sucesso');
      } else {
        // Tentar carregar o módulo
        const script = document.createElement('script');
        script.src = '../modules/VideoCompressor.js';
        script.onload = () => {
          this.videoCompressor = new window.VideoCompressor();
          console.log('VideoCompressor carregado e inicializado');
        };
        document.head.appendChild(script);
      }
    } catch (error) {
      console.log('⚠️ VideoCompressor não disponível, vídeos não serão comprimidos:', error);
    }
  }

  /**
     * Inicializa o StorageBuckets para organização por buckets
     */
    async initStorageBuckets() {
        try {
            if (this.config.useStorageBuckets && typeof window !== 'undefined' && window.StorageBuckets) {
                this.storageBuckets = new window.StorageBuckets();
                await this.storageBuckets.initialize();
                console.log('StorageBuckets inicializado com sucesso');
            } else if (this.config.useStorageBuckets) {
                // Tentar carregar o módulo
                const script = document.createElement('script');
                script.src = '../modules/StorageBuckets.js';
                script.onload = async () => {
                    this.storageBuckets = new window.StorageBuckets();
                    await this.storageBuckets.initialize();
                    console.log('StorageBuckets carregado e inicializado');
                };
                document.head.appendChild(script);
            }
        } catch (error) {
            console.log('⚠️ StorageBuckets não disponível, usando organização padrão:', error);
        }
    }

  /**
   * Armazena dados com otimizações
   */
  async store(key, data, options = {}) {
    const startTime = Date.now();
    
    try {
      // Se o contexto está invalidado, tentar usar IndexedDB como fallback
      if (this._contextInvalidated && !options.forceIndexedDB) {
        options.forceIndexedDB = true;
      }

      const {
        compress = this.compressionEnabled,
        ttl = this.maxItemAge,
        priority = 'normal',
        forceIndexedDB = false,
        bucket = null
      } = options;

      // Usar StorageBuckets se disponível e bucket especificado
      if (this.storageBuckets && bucket) {
        return await this.storeInBucket(key, data, bucket, options);
      }

      let metadata = {
        timestamp: Date.now(),
        compressed: false,
        videoCompressed: false,
        originalSize: this.calculateSize(data),
        ttl: ttl,
        priority: priority
      };

      // Comprimir vídeo se aplicável
       if (this.videoCompressionEnabled && this.videoCompressor && this.isVideoData(key, data)) {
         try {
           // Extrair blob de vídeo dos dados
           let videoBlob = null;
           if (data instanceof Blob) {
             videoBlob = data;
           } else if (data && data.blob instanceof Blob) {
             videoBlob = data.blob;
           } else if (data && data.data && typeof data.data === 'string' && data.data.startsWith('data:video')) {
             // Converter data URL para blob
             const response = await fetch(data.data);
             videoBlob = await response.blob();
           }
           
           if (videoBlob) {
             const compressionResult = await this.videoCompressor.compressVideo(videoBlob, {
               compressionLevel: this.videoCompressionLevel
             });
             
             if (compressionResult.success && compressionResult.compressedSize < metadata.originalSize) {
               // Atualizar dados com vídeo comprimido
               if (data instanceof Blob) {
                 data = compressionResult.compressedBlob;
               } else if (data && data.blob) {
                 data.blob = compressionResult.compressedBlob;
               } else if (data && data.data) {
                 // Converter blob comprimido de volta para data URL
                 const reader = new FileReader();
                 const dataURL = await new Promise((resolve) => {
                   reader.onload = () => resolve(reader.result);
                   reader.readAsDataURL(compressionResult.compressedBlob);
                 });
                 data.data = dataURL;
               }
               
               metadata.videoCompressed = true;
               metadata.compressedSize = compressionResult.compressedSize;
               metadata.compressionRatio = compressionResult.compressionRatio;
               
               console.log(`🎬 Vídeo comprimido: ${this.formatBytes(metadata.originalSize)} → ${this.formatBytes(metadata.compressedSize)} (${compressionResult.compressionRatio.toFixed(1)}% economia)`);
             }
           }
         } catch (videoError) {
           console.log('⚠️ Falha na compressão de vídeo, usando dados originais:', videoError);
         }
       }

      // Decidir qual storage usar baseado no tamanho dos dados
      const useIndexedDB = forceIndexedDB || 
                          metadata.originalSize > this.largeDataThreshold ||
                          (this.indexedDBManager && await this.shouldUseIndexedDB());

      if (useIndexedDB && this.indexedDBManager) {
        return await this.storeInIndexedDB(key, data, metadata, compress);
      } else {
        return await this.storeInChromeStorage(key, data, metadata, compress);
      }
      
    } catch (error) {
      // Tratamento específico para contexto invalidado
      if (this.isExtensionContextInvalidated(error)) {
        console.warn(`⚠️ Contexto invalidado ao tentar armazenar ${key} - operação abortada com segurança`);
        return false;
      }
      
      const duration = Date.now() - startTime;
      console.error(`❌ Erro no armazenamento de ${key} (${duration}ms):`, error);
      throw error;
    }
  }

  /**
   * Armazena dados no IndexedDB
   */
  async storeInIndexedDB(key, data, metadata, compress) {
    try {
      let processedData = data;
      
      // Compressão se habilitada
      if (compress && metadata.originalSize > this.compressionThreshold) {
        try {
          processedData = this.compress(data);
          metadata.compressed = true;
          metadata.compressedSize = this.calculateSize(processedData);
          console.log(`Dados comprimidos para IndexedDB: ${metadata.originalSize} → ${metadata.compressedSize} bytes`);
        } catch (error) {
          console.log('Falha na compressão, usando dados originais:', error);
        }
      }

      // Determinar o store baseado no tipo de dados
      let storeName = 'cache';
      if (key.includes('video')) storeName = 'videos';
      else if (key.includes('screenshot')) storeName = 'screenshots';
      else if (key.includes('log')) storeName = 'logs';

      await this.indexedDBManager.store(storeName, key, processedData, metadata);
      console.log(`✅ Dados armazenados no IndexedDB: ${key}`);
      return true;
      
    } catch (error) {
      console.log(`❌ Erro no IndexedDB, tentando chrome.storage.local:`, error);
      // Fallback para chrome.storage.local
      return await this.storeInChromeStorage(key, data, metadata, compress);
    }
  }

  /**
   * Armazena dados no chrome.storage.local
   */
  async storeInChromeStorage(key, data, metadata, compress) {
    try {
      // Verificar uso do storage antes de armazenar
      const usage = await this.getStorageUsage();
      if (usage.usagePercentage > 70) {
        console.log('⚠️ Uso do storage alto, executando limpeza preventiva');
        await this.performMaintenance();
      }
      
      let processedData = data;

      // Compressão se habilitada e dados grandes o suficiente
      if (compress && metadata.originalSize > this.compressionThreshold) {
        try {
          processedData = this.compress(data);
          metadata.compressed = true;
          metadata.compressedSize = this.calculateSize(processedData);
          console.log(`Dados comprimidos: ${metadata.originalSize} → ${metadata.compressedSize} bytes`);
        } catch (error) {
          console.log('Falha na compressão, usando dados originais:', error);
        }
      }

      // Formato plano esperado pelos testes
      const finalData = {
        data: processedData,
        compressed: !!metadata.compressed,
        timestamp: metadata.timestamp,
        ttl: metadata.ttl,
        size: metadata.compressed ? metadata.compressedSize : metadata.originalSize
      };

      // Tentar armazenar com retry
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          await chrome.storage.local.set({ [key]: finalData });
          console.log(`✅ Dados armazenados no chrome.storage.local: ${key}`);
          return true;
          
        } catch (error) {
          if (error.message?.includes('QUOTA_BYTES') || error.message?.includes('quota exceeded')) {
            console.log(`❌ Quota excedida na tentativa ${attempt}/${this.maxRetries}`);
            
            if (attempt === this.maxRetries) {
              // Última tentativa - limpeza de emergência
              console.log('🚨 Executando limpeza de emergência');
              await this.performEmergencyCleanup();
              
              // Tentar uma última vez após limpeza
              try {
                await chrome.storage.local.set({ [key]: finalData });
                console.log(`✅ Dados armazenados após limpeza de emergência: ${key}`);
                return true;
              } catch (finalError) {
                console.log('❌ Falha final no armazenamento:', finalError);
                throw new Error('Espaço de armazenamento insuficiente após limpeza');
              }
            } else {
              // Limpeza progressiva
              await this.performMaintenance();
              await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
            }
          } else {
            throw error;
          }
        }
      }
      
    } catch (error) {
      throw error;
    }
  }

  /**
     * Armazena dados em bucket específico usando StorageBuckets
     */
    async storeInBucket(key, data, bucketName, options = {}) {
        try {
            const {
                compress = this.compressionEnabled,
                ttl = null,
                priority = 'normal'
            } = options;

            let metadata = {
                timestamp: Date.now(),
                compressed: false,
                originalSize: this.calculateSize(data),
                ttl: ttl,
                priority: priority,
                bucketType: bucketName
            };

            let processedData = data;

            // Compressão se habilitada
            if (compress && metadata.originalSize > this.compressionThreshold) {
                try {
                    processedData = this.compress(data);
                    metadata.compressed = true;
                    metadata.compressedSize = this.calculateSize(processedData);
                    console.log(`Dados comprimidos para bucket ${bucketName}: ${metadata.originalSize} → ${metadata.compressedSize} bytes`);
                } catch (error) {
                    console.log('Falha na compressão, usando dados originais:', error);
                }
            }

            await this.storageBuckets.storeInBucket(key, processedData, metadata);
            console.log(`✅ Dados armazenados no bucket ${bucketName}: ${key}`);
            return true;
            
        } catch (error) {
            console.log(`❌ Erro no bucket ${bucketName}, tentando storage padrão:`, error);
            // Fallback para storage padrão
            return await this.storeInChromeStorage(key, data, metadata, compress);
        }
    }

  /**
   * Decide se deve usar IndexedDB baseado no estado atual
   */
  async shouldUseIndexedDB() {
    // Se o contexto está invalidado, usar IndexedDB como fallback
    if (this._contextInvalidated) {
      return true;
    }

    try {
      const usage = await this.getStorageUsage();
      return usage.usagePercentage > 50; // Usar IndexedDB se chrome.storage.local estiver mais de 50% cheio
    } catch (error) {
      // Em caso de erro, marcar contexto como invalidado se for esse o caso
      if (this.isExtensionContextInvalidated(error)) {
        this._contextInvalidated = true;
      }
      return false;
    }
  }

  /**
   * Tenta armazenar dados no storage especificado
   */
  async attemptStore(key, item, storage) {
    if (storage === 'chrome' && typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.set({ [key]: item });
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(item));
    } else {
      // Fallback para contexto de service worker
      await chrome.storage.local.set({ [key]: item });
    }
  }

  /**
   * Limpeza forçada quando quota é excedida durante operações de limpeza
   */
  async forceCleanupForQuota(storage = 'chrome') {
    console.log('🚨 Iniciando limpeza forçada para resolver quota excedida...');
    
    try {
      // 1. Remover todos os itens expirados sem verificações adicionais
      const keys = await this.listKeys(storage);
      let removedCount = 0;
      
      for (const key of keys) {
        try {
          // Tentar remover diretamente sem recuperar dados completos
          await this.remove(key, storage);
          removedCount++;
          
          // Parar se removemos muitos itens (evitar loop infinito)
          if (removedCount >= Math.min(keys.length * 0.5, 100)) {
            break;
          }
        } catch (removeError) {
          // Continuar mesmo se falhar ao remover um item específico
          console.warn(`Falha ao remover item ${key}:`, removeError.message);
        }
      }
      
      console.log(`🗑️ Limpeza forçada removeu ${removedCount} itens`);
      return removedCount > 0;
    } catch (error) {
      console.error('❌ Erro na limpeza forçada:', error);
      return false;
    }
  }

  /**
   * Realiza limpeza de emergência quando quota é excedida
   */
  async performEmergencyCleanup(storage = 'chrome') {
    console.log('🧹 Iniciando limpeza de emergência...');
    
    // 1. Limpar itens expirados primeiro
    const expiredCleaned = await this.cleanupExpiredItems(storage);
    console.log(`🗑️ Removidos ${expiredCleaned} itens expirados`);
    
    // 2. Verificar se ainda precisamos de mais espaço
    const usage = await this.getStorageUsage(storage);
    if (usage.usagePercentage > 80) {
      // 3. Limpar itens mais antigos até atingir 60% de uso
      const oldestCleaned = await this.cleanupOldestItems(storage, 60);
      console.log(`🗑️ Removidos ${oldestCleaned} itens antigos`);
    }
    
    // 4. Verificar uso final
    const finalUsage = await this.getStorageUsage(storage);
    console.log(`📊 Uso do storage após limpeza: ${finalUsage.usagePercentage.toFixed(1)}%`);
    
    return finalUsage.usagePercentage < 90; // Retorna true se conseguiu liberar espaço suficiente
  }

  /**
   * Recupera dados do armazenamento
   */
  async retrieve(key, options = {}) {
    try {
      const { bucket = null } = options;
      
      // Usar StorageBuckets se disponível e bucket especificado
      if (this.storageBuckets && bucket) {
        const data = await this.retrieveFromBucket(key, bucket);
        if (data !== null) {
          return data;
        }
      }
      
      // Tentar primeiro no IndexedDB se disponível
      if (this.indexedDBManager) {
        const data = await this.retrieveFromIndexedDB(key);
        if (data !== null) {
          return data;
        }
      }
      
      // Fallback para chrome.storage.local
      return await this.retrieveFromChromeStorage(key, options);
      
    } catch (error) {
      console.error('❌ Erro na recuperação de dados:', error);
      return null;
    }
  }

  /**
     * Recupera dados de bucket específico
     */
    async retrieveFromBucket(key, bucketName) {
        try {
            const result = await this.storageBuckets.getFromBucket(key, bucketName);
            
            if (result !== null) {
                console.log(`📥 Dados recuperados do bucket ${bucketName}: ${key}`);
                
                // Verificar se expirou
                if (result.metadata && this.isExpired(result)) {
                    // Remover item expirado (implementar método de remoção se necessário)
                    console.log(`⏰ Item expirado encontrado no bucket ${bucketName}: ${key}`);
                    return null;
                }
                
                // Descomprimir se necessário
                const data = result.metadata?.compressed ? this.decompress(result.data) : result.data;
                return data;
            }
            
            return null;
            
        } catch (error) {
            console.log(`⚠️ Erro ao recuperar do bucket ${bucketName}:`, error);
            return null;
        }
    }

  /**
   * Recupera dados do IndexedDB
   */
  async retrieveFromIndexedDB(key) {
    try {
      // Determinar o store baseado no tipo de dados
      let storeName = 'cache';
      if (key.includes('video')) storeName = 'videos';
      else if (key.includes('screenshot')) storeName = 'screenshots';
      else if (key.includes('log')) storeName = 'logs';

      const data = await this.indexedDBManager.retrieve(storeName, key);
      
      if (data !== null) {
        console.log(`📥 Dados recuperados do IndexedDB: ${key}`);
      }
      
      return data;
      
    } catch (error) {
      console.log('⚠️ Erro ao recuperar do IndexedDB:', error);
      return null;
    }
  }

  /**
   * Recupera dados do chrome.storage.local
   */
  async retrieveFromChromeStorage(key, options = {}) {
    const { storage = 'chrome' } = options;
    
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
            console.warn(`Erro ao parsear JSON para chave ${key}: ${parseError.message}`);
            console.warn(`Dados corrompidos (primeiros 100 chars): ${stored.substring(0, 100)}`);
            
            // Detectar padrões específicos de corrupção
            if (stored.startsWith('mobime-pp') || stored.includes('mobime')) {
              console.warn(`Detectado padrão de corrupção 'mobime-pp' na chave ${key}`);
            }
            
            // Log adicional para debug
            console.warn(`Tamanho total dos dados corrompidos: ${stored.length} chars`);
            console.warn(`Tipo de dados: ${typeof stored}`);
            
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
        console.log(`⏰ Item expirado removido: ${key}`);
        return null;
      }

      // Descomprimir se necessário
      const data = item.metadata?.compressed || item.compressed ? this.decompress(item.data) : item.data;
      console.log(`📥 Dados recuperados do chrome.storage.local: ${key}`);
      return data;
    } catch (error) {
      // Verificar se é erro de contexto invalidado
      if (this.isExtensionContextInvalidated(error)) {
        console.warn('⚠️ Contexto da extensão invalidado - operação de recuperação cancelada');
        return null;
      }
      
      console.error('❌ Erro ao recuperar dados do chrome.storage.local:', error);
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
   * Obtém estatísticas combinadas de uso do armazenamento
   */
  async getStorageUsage(storage = 'chrome') {
    try {
      // Se for solicitado storage específico, usar método legado
      if (storage !== 'chrome') {
        return await this.getLegacyStorageUsage(storage);
      }

      // Estatísticas do chrome.storage.local
      const chromeUsage = await this.getChromeStorageUsage();
      
      // Estatísticas do IndexedDB se disponível
      let indexedDBUsage = {
        totalSize: 0,
        itemCount: 0,
        usagePercentage: 0,
        stores: {}
      };
      
      if (this.indexedDBManager) {
        try {
          const stats = await this.indexedDBManager.getUsageStats();
          if (stats) {
            indexedDBUsage = {
              totalSize: stats.totalSize,
              itemCount: stats.totalItems,
              usagePercentage: 0, // IndexedDB não tem quota fixa
              stores: stats.stores
            };
          }
        } catch (error) {
          console.log('⚠️ Erro ao obter stats do IndexedDB:', error);
        }
      }
      
      // Estatísticas do StorageBuckets se disponível
        let bucketsUsage = {
            totalSize: 0,
            itemCount: 0,
            buckets: {}
        };
        
        if (this.storageBuckets) {
            try {
                const stats = await this.storageBuckets.getBucketStats();
                if (stats && stats.buckets) {
                    let totalSize = 0;
                    let totalItems = 0;
                    
                    for (const [bucketName, bucketStats] of Object.entries(stats.buckets)) {
                        if (bucketStats.usage) {
                            totalSize += bucketStats.usage;
                        }
                        // Estimar contagem de itens baseado no uso médio
                        if (bucketStats.usage) {
                            totalItems += Math.ceil(bucketStats.usage / 1024); // Estimativa
                        }
                    }
                    
                    bucketsUsage = {
                        totalSize: totalSize,
                        itemCount: totalItems,
                        buckets: stats.buckets
                    };
                }
            } catch (error) {
                console.log('⚠️ Erro ao obter stats do StorageBuckets:', error);
            }
        }
      
      // Retornar apenas a estrutura simples esperada pelos testes
      return {
        totalSize: chromeUsage.totalSize + indexedDBUsage.totalSize + bucketsUsage.totalSize,
        itemCount: chromeUsage.itemCount + indexedDBUsage.itemCount + bucketsUsage.itemCount,
        usagePercentage: chromeUsage.usagePercentage
      };
    } catch (error) {
      console.error('❌ Erro ao obter uso do armazenamento:', error);
      return this.getEmptyUsageStats();
    }
  }

  /**
   * Obtém estatísticas específicas do chrome.storage.local
   */
  async getChromeStorageUsage() {
    // Cache para evitar chamadas repetidas em contexto invalidado
    if (this._contextInvalidated) {
      return { totalSize: 0, itemCount: 0, usagePercentage: 0 };
    }

    // Verificação defensiva de API
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      // Silencioso em contextos onde a API não está disponível
      return { totalSize: 0, itemCount: 0, usagePercentage: 0 };
    }

    try {
      let totalSize = 0;
      let itemCount = 0;

      try {
        const result = await chrome.storage.local.get(null);
        for (const [key, value] of Object.entries(result)) {
          try {
            totalSize += this.calculateSize(value);
            itemCount++;
          } catch (sizeError) {
            console.warn(`Erro ao calcular tamanho do item ${key}:`, sizeError.message);
            itemCount++;
          }
        }
      } catch (chromeStorageError) {
        if (chromeStorageError.message && chromeStorageError.message.includes('quota exceeded')) {
          console.warn('⚠️ Quota excedida ao obter todos os itens - usando estimativa');
          return {
            totalSize: this.maxStorageSize * 0.95,
            itemCount: 0,
            usagePercentage: 95
          };
        }
        throw chromeStorageError;
      }

      return {
        totalSize,
        itemCount,
        usagePercentage: (totalSize / this.maxStorageSize) * 100
      };
    } catch (error) {
      if (this.isExtensionContextInvalidated(error)) {
        // Marcar contexto como invalidado para evitar chamadas futuras
        this._contextInvalidated = true;
        console.warn('⚠️ Contexto da extensão invalidado - cálculo de uso cancelado');
        return { totalSize: 0, itemCount: 0, usagePercentage: 0 };
      }
      
      if (error.message && error.message.includes('quota exceeded')) {
        console.warn('⚠️ Quota excedida durante cálculo de uso - retornando estimativa alta');
        return {
          totalSize: this.maxStorageSize * 0.98,
          itemCount: 0,
          usagePercentage: 98
        };
      }
      
      throw error;
    }
  }

  /**
   * Método legado para compatibilidade com storage específico
   */
  async getLegacyStorageUsage(storage) {
    try {
      let totalSize = 0;
      let itemCount = 0;

      if (storage === 'chrome' && typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.local.get(null);
        for (const [key, value] of Object.entries(result)) {
          try {
            totalSize += this.calculateSize(value);
            itemCount++;
          } catch (sizeError) {
            console.warn(`Erro ao calcular tamanho do item ${key}:`, sizeError.message);
            itemCount++;
          }
        }
      } else if (typeof localStorage !== 'undefined') {
        for (let i = 0; i < localStorage.length; i++) {
          try {
            const key = localStorage.key(i);
            const value = localStorage.getItem(key);
            totalSize += this.calculateSize(value);
            itemCount++;
          } catch (localStorageError) {
            console.warn(`Erro ao processar item ${i} do localStorage:`, localStorageError.message);
            itemCount++;
          }
        }
      }

      return {
        totalSize,
        itemCount,
        usagePercentage: (totalSize / this.maxStorageSize) * 100
      };
    } catch (error) {
      console.error('Erro ao calcular uso do armazenamento legado:', error);
      return { totalSize: 0, itemCount: 0, usagePercentage: 0 };
    }
  }

  /**
   * Retorna estatísticas vazias em caso de erro
   */
  getEmptyUsageStats() {
    const empty = {
      totalSize: 0,
      itemCount: 0,
      usagePercentage: 0
    };
    
    return {
      ...empty,
      chrome: empty,
      indexedDB: { ...empty, stores: {} },
      buckets: { ...empty, buckets: {} },
      combined: {
        totalSize: 0,
        itemCount: 0,
        formattedSize: '0 B'
      }
    };
  }

  /**
   * Formata bytes em formato legível
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Limpa itens expirados
   */
  async cleanupExpiredItems(storage = 'chrome') {
    try {
      const keys = await this.listKeys(storage);
      let cleanedCount = 0;
      let errorCount = 0;
      let corruptedCount = 0;

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
          
          // Detectar se é corrupção específica do tipo 'mobime-pp'
          if (itemError.message.includes('mobime-pp')) {
            console.warn(`Detectada corrupção 'mobime-pp' na chave ${key} - removendo automaticamente`);
            corruptedCount++;
          }
          
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
    // Throttling: evitar manutenção muito frequente
    const now = Date.now();
    if (this.lastMaintenance && (now - this.lastMaintenance) < this.maintenanceInterval) {
      return { skipped: true, reason: 'throttled', nextMaintenance: this.lastMaintenance + this.maintenanceInterval };
    }
    this.lastMaintenance = now;

    console.log('🔧 Iniciando manutenção do storage...');
    
    try {
      const results = {
        chrome: { expired: 0, oldest: 0 },
        local: { expired: 0, oldest: 0 }
      };

      // 1. Limpar dados corrompidos conhecidos
      console.log('🧹 Limpando dados corrompidos...');
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const corruptedReport = await this.cleanupCorruptedData('chrome');
        const chromeCorrupted = corruptedReport.cleanedKeys.length;
        if (chromeCorrupted > 0) {
          console.log(`🗑️ Removidos ${chromeCorrupted} itens corrompidos do chrome.storage`);
        }
      }
      
      const localCorruptedReport = await this.cleanupCorruptedData('local');
      const localCorrupted = localCorruptedReport.cleanedKeys.length;
      if (localCorrupted > 0) {
        console.log(`🗑️ Removidos ${localCorrupted} itens corrompidos do localStorage`);
      }

      // 2. Limpeza do chrome.storage
      if (typeof chrome !== 'undefined' && chrome.storage) {
        results.chrome.expired = await this.cleanupExpiredItems('chrome');
        results.chrome.oldest = await this.cleanupOldestItems('chrome');
      }

      // 3. Limpeza do localStorage
      results.local.expired = await this.cleanupExpiredItems('local');
      results.local.oldest = await this.cleanupOldestItems('local');

      // 4. Gerar relatório final
      const usage = await this.getStorageUsage('chrome');
      console.log(`✅ Manutenção concluída. Uso do storage: ${usage.usagePercentage.toFixed(1)}%`);
      
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
    
    // Detectar padrões específicos de corrupção conhecidos
    if (trimmed.startsWith('mobime-pp') || trimmed.includes('mobime')) {
      throw new Error(`Dados corrompidos detectados - padrão 'mobime-pp': ${trimmed.substring(0, 50)}...`);
    }
    
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
      // Fornecer mais contexto sobre o erro
      const preview = trimmed.substring(0, 100);
      throw new Error(`Erro de parsing JSON para chave ${key}: ${parseError.message}. Preview: ${preview}`);
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
   * Limpa dados corrompidos conhecidos (como 'mobime-pp')
   */
  async cleanupCorruptedData(storage = 'chrome') {
    const report = {
      totalKeys: 0,
      cleanedKeys: [],
      errors: []
    };

    try {
      const keys = await this.listKeys(storage);
      report.totalKeys = keys.length;
      let cleanedCount = 0;

      for (const key of keys) {
        try {
          if (storage === 'chrome' && typeof chrome !== 'undefined' && chrome.storage) {
            const result = await chrome.storage.local.get([key]);
            const item = result[key];
            if (item && typeof item === 'string' && (item.startsWith('mobime-pp') || item.includes('mobime'))) {
              await this.remove(key, storage);
              report.cleanedKeys.push({ key, reason: 'mobime-pp pattern detected' });
              cleanedCount++;
            }
          } else if (typeof localStorage !== 'undefined') {
            const stored = localStorage.getItem(key);
            if (stored && (stored.startsWith('mobime-pp') || stored.includes('mobime'))) {
              localStorage.removeItem(key);
              report.cleanedKeys.push({ key, reason: 'mobime-pp pattern detected' });
              cleanedCount++;
            }
          }
        } catch (error) {
          report.errors.push({ key, error: error.message });
        }
      }

      // Log consolidado apenas se houver limpeza
      if (cleanedCount > 0) {
        console.log(`🧹 Limpeza de dados corrompidos: ${cleanedCount} itens removidos (${storage})`);
      }
    } catch (error) {
      console.error('Erro durante limpeza de dados corrompidos:', error);
      report.errors.push({ general: error.message });
    }

    return report;
  }

  /**
   * Detecta dados corrompidos no storage
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
   * Verifica se os dados são de vídeo baseado na chave e conteúdo
   */
  isVideoData(key, data) {
    // Verificar pela chave
    if (key.includes('video') || key.includes('recording') || key.includes('screen-capture')) {
      return true;
    }
    
    // Verificar pelo tipo de dados
    if (data && typeof data === 'object') {
      if (data.type && data.type.includes('video')) {
        return true;
      }
      if (data.mimeType && data.mimeType.includes('video')) {
        return true;
      }
      if (data.blob && data.blob.type && data.blob.type.includes('video')) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Lista buckets disponíveis
   */
  async listBuckets() {
    if (this.storageBuckets) {
      return await this.storageBuckets.listBuckets();
    }
    return [];
  }

  /**
   * Cria um novo bucket
   */
  async createBucket(bucketName, options = {}) {
    if (this.storageBuckets) {
      return await this.storageBuckets.createBucket(bucketName, options);
    }
    return false;
  }

  /**
   * Remove um bucket e todos os seus dados
   */
  async removeBucket(bucketName) {
    if (this.storageBuckets) {
      return await this.storageBuckets.removeBucket(bucketName);
    }
    return false;
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