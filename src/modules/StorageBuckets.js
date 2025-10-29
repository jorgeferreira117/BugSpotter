/**
 * StorageBuckets - Gerenciador de Storage Buckets API para organização de dados por tipo
 * 
 * A Storage Buckets API permite criar múltiplos buckets de armazenamento independentes,
 * onde o navegador pode deletar cada bucket independentemente dos outros.
 * Isso permite especificar prioridades de evicção para garantir que os dados mais
 * valiosos não sejam deletados.
 * 
 * Disponível a partir do Chrome 122+
 */

class StorageBuckets {
    constructor() {
        this.buckets = new Map();
        this.isSupported = 'storageBuckets' in navigator;
        this.bucketConfigs = {
            // Dados críticos - alta prioridade, persistente
            critical: {
                name: 'bugspotter-critical',
                persisted: true,
                durability: 'strict',
                description: 'Dados críticos como configurações e preferências do usuário'
            },
            // Dados de sessão - média prioridade
            session: {
                name: 'bugspotter-session',
                persisted: false,
                durability: 'relaxed',
                description: 'Dados temporários da sessão atual'
            },
            // Vídeos e mídia - baixa prioridade, mas persistente
            media: {
                name: 'bugspotter-media',
                persisted: true,
                durability: 'relaxed',
                description: 'Vídeos, screenshots e outros arquivos de mídia'
            },
            // Logs e analytics - muito baixa prioridade
            logs: {
                name: 'bugspotter-logs',
                persisted: false,
                durability: 'relaxed',
                description: 'Logs de debug e dados de analytics'
            },
            // Cache temporário - pode ser deletado a qualquer momento
            cache: {
                name: 'bugspotter-cache',
                persisted: false,
                durability: 'relaxed',
                description: 'Cache temporário e dados descartáveis'
            }
        };
    }

    /**
     * Inicializa os buckets de armazenamento
     */
    async initialize() {
        if (!this.isSupported) {
            console.warn('Storage Buckets API não suportada. Usando armazenamento padrão.');
            return false;
        }

        try {
            // Inicializa todos os buckets configurados
            for (const [type, config] of Object.entries(this.bucketConfigs)) {
                await this.createBucket(type, config);
            }
            
            console.log('Storage Buckets inicializados com sucesso:', Array.from(this.buckets.keys()));
            return true;
        } catch (error) {
            console.error('Erro ao inicializar Storage Buckets:', error);
            return false;
        }
    }

    /**
     * Cria um bucket de armazenamento
     */
    async createBucket(type, config) {
        if (!this.isSupported) {
            return null;
        }

        try {
            const bucket = await navigator.storageBuckets.open(config.name, {
                persisted: config.persisted,
                durability: config.durability
            });
            
            this.buckets.set(type, {
                bucket,
                config,
                indexedDB: bucket.indexedDB
            });
            
            console.log(`Bucket '${type}' criado:`, config.description);
            return bucket;
        } catch (error) {
            console.error(`Erro ao criar bucket '${type}':`, error);
            return null;
        }
    }

    /**
     * Obtém um bucket por tipo
     */
    getBucket(type) {
        if (!this.isSupported) {
            return null;
        }
        
        const bucketInfo = this.buckets.get(type);
        return bucketInfo ? bucketInfo.bucket : null;
    }

    /**
     * Obtém a instância IndexedDB de um bucket específico
     */
    getIndexedDB(type) {
        if (!this.isSupported) {
            return indexedDB; // Fallback para IndexedDB padrão
        }
        
        const bucketInfo = this.buckets.get(type);
        return bucketInfo ? bucketInfo.indexedDB : indexedDB;
    }

    /**
     * Determina o tipo de bucket apropriado para os dados
     */
    determineBucketType(data, metadata = {}) {
        // Dados críticos do sistema
        if (metadata.critical || 
            (typeof data === 'object' && data.type === 'settings') ||
            (typeof data === 'object' && data.type === 'user-preferences')) {
            return 'critical';
        }
        
        // Dados de mídia (vídeos, imagens)
        if (metadata.isMedia || 
            (typeof data === 'object' && (data.type === 'video' || data.type === 'screenshot')) ||
            (data instanceof Blob && data.type.startsWith('video/')) ||
            (data instanceof Blob && data.type.startsWith('image/'))) {
            return 'media';
        }
        
        // Logs e analytics
        if (metadata.isLog || 
            (typeof data === 'object' && (data.type === 'log' || data.type === 'analytics'))) {
            return 'logs';
        }
        
        // Cache temporário
        if (metadata.isCache || 
            (typeof data === 'object' && data.type === 'cache')) {
            return 'cache';
        }
        
        // Dados de sessão (padrão)
        return 'session';
    }

    /**
     * Armazena dados no bucket apropriado
     */
    async storeInBucket(key, data, metadata = {}) {
        const bucketType = this.determineBucketType(data, metadata);
        const idb = this.getIndexedDB(bucketType);
        
        try {
            return new Promise((resolve, reject) => {
                const request = idb.open('bugspotter-data', 1);
                
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains('data')) {
                        db.createObjectStore('data', { keyPath: 'key' });
                    }
                };
                
                request.onsuccess = (event) => {
                    const db = event.target.result;
                    const transaction = db.transaction(['data'], 'readwrite');
                    const store = transaction.objectStore('data');
                    
                    const storeData = {
                        key,
                        data,
                        metadata: {
                            ...metadata,
                            bucketType,
                            timestamp: Date.now()
                        }
                    };
                    
                    const putRequest = store.put(storeData);
                    
                    putRequest.onsuccess = () => {
                        console.log(`Dados armazenados no bucket '${bucketType}':`, key);
                        resolve({ success: true, bucketType });
                    };
                    
                    putRequest.onerror = () => {
                        reject(putRequest.error);
                    };
                };
                
                request.onerror = () => {
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error('Erro ao armazenar dados no bucket:', error);
            throw error;
        }
    }

    /**
     * Recupera dados de um bucket
     */
    async getFromBucket(key, bucketType = null) {
        // Se não especificado, tenta encontrar em todos os buckets
        const bucketsToSearch = bucketType ? [bucketType] : Object.keys(this.bucketConfigs);
        
        for (const type of bucketsToSearch) {
            const idb = this.getIndexedDB(type);
            
            try {
                const result = await new Promise((resolve, reject) => {
                    const request = idb.open('bugspotter-data', 1);
                    
                    request.onsuccess = (event) => {
                        const db = event.target.result;
                        const transaction = db.transaction(['data'], 'readonly');
                        const store = transaction.objectStore('data');
                        const getRequest = store.get(key);
                        
                        getRequest.onsuccess = () => {
                            resolve(getRequest.result);
                        };
                        
                        getRequest.onerror = () => {
                            reject(getRequest.error);
                        };
                    };
                    
                    request.onerror = () => {
                        reject(request.error);
                    };
                });
                
                if (result) {
                    return result;
                }
            } catch (error) {
                console.warn(`Erro ao buscar dados no bucket '${type}':`, error);
            }
        }
        
        return null;
    }

    /**
     * Lista todos os buckets disponíveis
     */
    async listBuckets() {
        if (!this.isSupported) {
            return [];
        }
        
        try {
            const bucketNames = await navigator.storageBuckets.keys();
            return bucketNames;
        } catch (error) {
            console.error('Erro ao listar buckets:', error);
            return [];
        }
    }

    /**
     * Obtém estatísticas de uso dos buckets
     */
    async getBucketStats() {
        const stats = {
            supported: this.isSupported,
            buckets: {},
            total: {
                count: 0,
                usage: 0
            }
        };
        
        if (!this.isSupported) {
            return stats;
        }
        
        for (const [type, bucketInfo] of this.buckets) {
            try {
                const bucket = bucketInfo.bucket;
                const estimate = await bucket.estimate();
                
                stats.buckets[type] = {
                    config: bucketInfo.config,
                    usage: estimate.usage || 0,
                    quota: estimate.quota || 0,
                    usageDetails: estimate.usageDetails || {}
                };
                
                stats.total.count++;
                stats.total.usage += estimate.usage || 0;
            } catch (error) {
                console.warn(`Erro ao obter estatísticas do bucket '${type}':`, error);
                stats.buckets[type] = {
                    config: bucketInfo.config,
                    error: error.message
                };
            }
        }
        
        return stats;
    }

    /**
     * Limpa um bucket específico
     */
    async clearBucket(type) {
        if (!this.isSupported) {
            return false;
        }
        
        const bucketInfo = this.buckets.get(type);
        if (!bucketInfo) {
            console.warn(`Bucket '${type}' não encontrado`);
            return false;
        }
        
        try {
            await navigator.storageBuckets.delete(bucketInfo.config.name);
            this.buckets.delete(type);
            console.log(`Bucket '${type}' limpo com sucesso`);
            return true;
        } catch (error) {
            console.error(`Erro ao limpar bucket '${type}':`, error);
            return false;
        }
    }

    /**
     * Migra dados entre buckets
     */
    async migrateBucket(fromType, toType) {
        if (!this.isSupported) {
            return false;
        }
        
        try {
            // Implementação de migração seria mais complexa
            // Por enquanto, apenas log da intenção
            console.log(`Migração de bucket '${fromType}' para '${toType}' solicitada`);
            return true;
        } catch (error) {
            console.error('Erro na migração de bucket:', error);
            return false;
        }
    }
}

// Exporta a classe
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StorageBuckets;
} else if (typeof window !== 'undefined') {
    window.StorageBuckets = StorageBuckets;
}