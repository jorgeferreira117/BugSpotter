/**
 * StorageMonitor - Monitoramento proativo do uso de armazenamento
 * Fornece alertas e estatísticas em tempo real sobre o uso de storage
 */
class StorageMonitor {
  constructor(storageManager) {
    this.storageManager = storageManager;
    this.monitoringInterval = null;
    this.alertThresholds = {
      warning: 70,    // 70% - aviso
      critical: 85,   // 85% - crítico
      emergency: 95   // 95% - emergência
    };
    this.monitoringFrequency = 30000; // 30 segundos
    this.lastAlertLevel = null;
    this.callbacks = {
      warning: [],
      critical: [],
      emergency: [],
      stats: []
    };
    this.isMonitoring = false;
    this.stats = {
      totalChecks: 0,
      alertsTriggered: 0,
      lastCheck: null,
      averageUsage: 0,
      peakUsage: 0,
      cleanupEvents: 0
    };
  }

  /**
   * Inicia o monitoramento automático
   */
  startMonitoring() {
    if (this.isMonitoring) {
      console.log('📊 Monitoramento já está ativo');
      return;
    }

    this.isMonitoring = true;
    console.log('🚀 Iniciando monitoramento de storage');
    
    // Primeira verificação imediata
    this.checkStorageUsage();
    
    // Configurar verificações periódicas
    this.monitoringInterval = setInterval(() => {
      this.checkStorageUsage();
    }, this.monitoringFrequency);
  }

  /**
   * Para o monitoramento automático
   */
  stopMonitoring() {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    console.log('⏹️ Monitoramento de storage parado');
  }

  /**
   * Verifica o uso atual do storage e dispara alertas se necessário
   */
  async checkStorageUsage() {
    try {
      const usage = await this.storageManager.getStorageUsage();
      const currentTime = Date.now();
      
      // Atualizar estatísticas
      this.updateStats(usage, currentTime);
      
      // Verificar se precisa disparar alertas
      const alertLevel = this.determineAlertLevel(usage.chrome?.percentage || usage.usagePercentage || 0);
      
      if (alertLevel && alertLevel !== this.lastAlertLevel) {
        await this.triggerAlert(alertLevel, usage);
        this.lastAlertLevel = alertLevel;
        this.stats.alertsTriggered++;
      } else if (!alertLevel) {
        this.lastAlertLevel = null;
      }
      
      // Notificar callbacks de estatísticas
      this.notifyStatsCallbacks(usage);
      
      console.log(`📊 Storage check: ${usage.chrome?.formattedUsed || this.formatBytes(usage.totalSize)} usado`);
      
    } catch (error) {
      console.error('❌ Erro no monitoramento de storage:', error);
    }
  }

  /**
   * Determina o nível de alerta baseado na porcentagem de uso
   */
  determineAlertLevel(percentage) {
    if (percentage >= this.alertThresholds.emergency) {
      return 'emergency';
    } else if (percentage >= this.alertThresholds.critical) {
      return 'critical';
    } else if (percentage >= this.alertThresholds.warning) {
      return 'warning';
    }
    return null;
  }

  /**
   * Dispara um alerta e executa ações automáticas se necessário
   */
  async triggerAlert(level, usage) {
    const percentage = usage.chrome?.percentage || usage.usagePercentage || 0;
    const message = this.getAlertMessage(level, percentage);
    
    console.warn(`🚨 ${message}`);
    
    // Executar callbacks registrados
    this.callbacks[level].forEach(callback => {
      try {
        callback(usage, level, message);
      } catch (error) {
        console.error('❌ Erro em callback de alerta:', error);
      }
    });
    
    // Ações automáticas baseadas no nível
    switch (level) {
      case 'warning':
        // Apenas alertar, sem ação automática
        break;
        
      case 'critical':
        console.log('🧹 Executando limpeza automática (nível crítico)');
        try {
          await this.storageManager.performMaintenance();
          this.stats.cleanupEvents++;
        } catch (error) {
          console.error('❌ Falha na limpeza automática:', error);
        }
        break;
        
      case 'emergency':
        console.log('🚨 Executando limpeza de emergência');
        try {
          await this.storageManager.performEmergencyCleanup();
          
          // Se IndexedDB disponível, mover dados grandes
          if (this.storageManager.indexedDBManager) {
            await this.migrateDataToIndexedDB();
          }
          
          this.stats.cleanupEvents++;
        } catch (error) {
          console.error('❌ Falha na limpeza de emergência:', error);
        }
        break;
    }
  }

  /**
   * Migra dados grandes para IndexedDB em situação de emergência
   */
  async migrateDataToIndexedDB() {
    try {
      console.log('📦 Migrando dados grandes para IndexedDB...');
      
      // Obter todos os dados do chrome.storage.local
      const allData = await chrome.storage.local.get(null);
      let migratedCount = 0;
      
      for (const [key, value] of Object.entries(allData)) {
        try {
          const size = this.storageManager.calculateSize(value);
          
          // Migrar itens maiores que 100KB
          if (size > 100 * 1024) {
            await this.storageManager.store(key, value.data || value, {
              forceIndexedDB: true,
              ttl: value.metadata?.ttl
            });
            
            // Remover do chrome.storage.local
            await chrome.storage.local.remove(key);
            migratedCount++;
            
            console.log(`📦 Migrado para IndexedDB: ${key} (${this.formatBytes(size)})`);
          }
        } catch (error) {
          console.error(`❌ Erro ao migrar ${key}:`, error);
        }
      }
      
      console.log(`✅ Migração concluída: ${migratedCount} itens movidos para IndexedDB`);
      
    } catch (error) {
      console.error('❌ Erro na migração para IndexedDB:', error);
    }
  }

  /**
   * Gera mensagem de alerta apropriada
   */
  getAlertMessage(level, percentage) {
    const messages = {
      warning: `Aviso: Uso de storage em ${percentage.toFixed(1)}% - considere limpeza`,
      critical: `Crítico: Uso de storage em ${percentage.toFixed(1)}% - limpeza automática iniciada`,
      emergency: `Emergência: Uso de storage em ${percentage.toFixed(1)}% - limpeza de emergência iniciada`
    };
    
    return messages[level] || `Alerta de storage: ${percentage.toFixed(1)}%`;
  }

  /**
   * Atualiza estatísticas de monitoramento
   */
  updateStats(usage, currentTime) {
    this.stats.totalChecks++;
    this.stats.lastCheck = currentTime;
    
    const currentUsage = usage.chrome?.percentage || usage.usagePercentage || 0;
    
    // Atualizar média móvel
    this.stats.averageUsage = (
      (this.stats.averageUsage * (this.stats.totalChecks - 1) + currentUsage) / 
      this.stats.totalChecks
    );
    
    // Atualizar pico de uso
    if (currentUsage > this.stats.peakUsage) {
      this.stats.peakUsage = currentUsage;
    }
  }

  /**
   * Registra callback para alertas de um nível específico
   */
  onAlert(level, callback) {
    if (this.callbacks[level]) {
      this.callbacks[level].push(callback);
    }
  }

  /**
   * Registra callback para atualizações de estatísticas
   */
  onStatsUpdate(callback) {
    this.callbacks.stats.push(callback);
  }

  /**
   * Notifica callbacks de estatísticas
   */
  notifyStatsCallbacks(usage) {
    this.callbacks.stats.forEach(callback => {
      try {
        callback(usage, this.stats);
      } catch (error) {
        console.error('❌ Erro em callback de stats:', error);
      }
    });
  }

  /**
   * Remove callback registrado
   */
  removeCallback(level, callback) {
    if (this.callbacks[level]) {
      const index = this.callbacks[level].indexOf(callback);
      if (index > -1) {
        this.callbacks[level].splice(index, 1);
      }
    }
  }

  /**
   * Obtém estatísticas detalhadas do monitoramento
   */
  getMonitoringStats() {
    return {
      ...this.stats,
      isMonitoring: this.isMonitoring,
      monitoringFrequency: this.monitoringFrequency,
      alertThresholds: this.alertThresholds,
      lastAlertLevel: this.lastAlertLevel,
      uptime: this.isMonitoring ? Date.now() - (this.stats.lastCheck - this.monitoringFrequency) : 0
    };
  }

  /**
   * Configura limites de alerta personalizados
   */
  setAlertThresholds(thresholds) {
    this.alertThresholds = { ...this.alertThresholds, ...thresholds };
    console.log('⚙️ Limites de alerta atualizados:', this.alertThresholds);
  }

  /**
   * Configura frequência de monitoramento
   */
  setMonitoringFrequency(frequency) {
    this.monitoringFrequency = frequency;
    
    if (this.isMonitoring) {
      // Reiniciar monitoramento com nova frequência
      this.stopMonitoring();
      this.startMonitoring();
    }
    
    console.log(`⚙️ Frequência de monitoramento atualizada: ${frequency}ms`);
  }

  /**
   * Força uma verificação imediata
   */
  async forceCheck() {
    console.log('🔍 Verificação forçada de storage');
    await this.checkStorageUsage();
  }

  /**
   * Reseta estatísticas de monitoramento
   */
  resetStats() {
    this.stats = {
      totalChecks: 0,
      alertsTriggered: 0,
      lastCheck: null,
      averageUsage: 0,
      peakUsage: 0,
      cleanupEvents: 0
    };
    
    console.log('📊 Estatísticas de monitoramento resetadas');
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
   * Cleanup ao destruir o monitor
   */
  destroy() {
    this.stopMonitoring();
    this.callbacks = {
      warning: [],
      critical: [],
      emergency: [],
      stats: []
    };
    console.log('🗑️ StorageMonitor destruído');
  }
}

// Exportar para uso global
if (typeof window !== 'undefined') {
  window.StorageMonitor = StorageMonitor;
}

// Exportar para módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageMonitor;
}