/**
 * BackgroundModules - Módulos Especializados para Background Script
 * Extrai funcionalidades do background.js para melhor organização
 */

// ==================== HTTP ERROR HANDLER ====================

class HTTPErrorHandler {
  constructor() {
    this.processedErrors = new Map();
    this.errorQueue = [];
    this.isProcessing = false;
    this.maxQueueSize = 100;
    this.processingInterval = 5000; // 5 segundos
    
    // Iniciar processamento automático
    this.startProcessing();
  }

  /**
   * Processa erro HTTP capturado
   */
  async processHTTPError(details) {
    try {
      // Filtrar erros irrelevantes
      if (this._shouldIgnoreError(details)) {
        return;
      }

      // Verificar duplicação
      const errorKey = this._generateErrorKey(details);
      if (this.processedErrors.has(errorKey)) {
        return;
      }

      // Adicionar à fila de processamento
      this._addToQueue({
        ...details,
        timestamp: Date.now(),
        errorKey
      });

    } catch (error) {
      console.error('[HTTPErrorHandler] Error processing HTTP error:', error);
    }
  }

  /**
   * Adiciona erro à fila de processamento
   */
  _addToQueue(errorData) {
    // Limitar tamanho da fila
    if (this.errorQueue.length >= this.maxQueueSize) {
      this.errorQueue.shift(); // Remove o mais antigo
    }

    this.errorQueue.push(errorData);
    
    // Marcar como processado para evitar duplicatas
    this.processedErrors.set(errorData.errorKey, Date.now());
    
    // Limpar cache de erros processados (manter apenas últimos 1000)
    if (this.processedErrors.size > 1000) {
      const entries = Array.from(this.processedErrors.entries());
      entries.sort((a, b) => b[1] - a[1]); // Ordenar por timestamp desc
      
      this.processedErrors.clear();
      entries.slice(0, 500).forEach(([key, timestamp]) => {
        this.processedErrors.set(key, timestamp);
      });
    }
  }

  /**
   * Inicia processamento automático da fila
   */
  startProcessing() {
    setInterval(() => {
      this._processQueue();
    }, this.processingInterval);
  }

  /**
   * Processa fila de erros
   */
  async _processQueue() {
    if (this.isProcessing || this.errorQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      const batch = this.errorQueue.splice(0, 10); // Processar até 10 por vez
      
      for (const errorData of batch) {
        await this._processError(errorData);
      }

    } catch (error) {
      console.error('[HTTPErrorHandler] Error processing queue:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Processa erro individual
   */
  async _processError(errorData) {
    try {
      // Obter configurações
      const settings = await this._getSettings();
      
      if (!settings.notifications?.enabled || !settings.notifications?.httpErrors) {
        return;
      }

      // Verificar threshold de erro
      if (errorData.statusCode < (settings.notifications?.errorThreshold || 400)) {
        return;
      }

      // Criar notificação se habilitada
      if (settings.notifications?.enabled) {
        await this._createErrorNotification(errorData);
      }

      // Enviar para IA se habilitada
      if (settings.ai?.enabled && settings.ai?.autoNotify) {
        await this._sendToAI(errorData);
      }

    } catch (error) {
      console.error('[HTTPErrorHandler] Error processing individual error:', error);
    }
  }

  /**
   * Verifica se deve ignorar o erro
   */
  _shouldIgnoreError(details) {
    const { url, statusCode, method } = details;

    // Ignorar URLs de extensões
    if (url.startsWith('chrome-extension://') || url.startsWith('moz-extension://')) {
      return true;
    }

    // Ignorar alguns status codes comuns
    const ignoredStatusCodes = [301, 302, 304, 307, 308]; // Redirects e Not Modified
    if (ignoredStatusCodes.includes(statusCode)) {
      return true;
    }

    // Ignorar OPTIONS requests
    if (method === 'OPTIONS') {
      return true;
    }

    // Ignorar URLs de analytics e tracking
    const ignoredDomains = [
      'google-analytics.com',
      'googletagmanager.com',
      'facebook.com/tr',
      'doubleclick.net'
    ];

    return ignoredDomains.some(domain => url.includes(domain));
  }

  /**
   * Gera chave única para o erro
   */
  _generateErrorKey(details) {
    const { url, statusCode, method } = details;
    return `${method}:${statusCode}:${url.split('?')[0]}`; // Remove query params
  }

  /**
   * Cria notificação de erro
   */
  async _createErrorNotification(errorData) {
    try {
      const { url, statusCode, method } = errorData;
      
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon48.png',
        title: 'HTTP Error Detected',
        message: `${method} ${statusCode} - ${new URL(url).hostname}`,
        contextMessage: `Click to create bug report`,
        requireInteraction: false
      });

    } catch (error) {
      console.error('[HTTPErrorHandler] Error creating notification:', error);
    }
  }

  /**
   * Envia erro para análise de IA
   */
  async _sendToAI(errorData) {
    try {
      // Implementar envio para IA
      // Esta funcionalidade será integrada com o AIService
      console.log('[HTTPErrorHandler] Sending to AI:', errorData);
      
    } catch (error) {
      console.error('[HTTPErrorHandler] Error sending to AI:', error);
    }
  }

  /**
   * Obtém configurações
   */
  async _getSettings() {
    try {
      const result = await chrome.storage.local.get(['settings']);
      return result.settings || {};
    } catch (error) {
      console.error('[HTTPErrorHandler] Error getting settings:', error);
      return {};
    }
  }
}

// ==================== MESSAGE ROUTER ====================

class MessageRouter {
  constructor() {
    this.handlers = new Map();
    this.middleware = [];
    this.setupDefaultHandlers();
  }

  /**
   * Registra handler para ação específica
   */
  registerHandler(action, handler) {
    this.handlers.set(action, handler);
  }

  /**
   * Adiciona middleware para processamento de mensagens
   */
  addMiddleware(middleware) {
    this.middleware.push(middleware);
  }

  /**
   * Processa mensagem recebida
   */
  async handleMessage(message, sender, sendResponse) {
    try {
      // Aplicar middleware
      for (const middleware of this.middleware) {
        const result = await middleware(message, sender);
        if (result === false) {
          return; // Middleware bloqueou a mensagem
        }
      }

      // Obter handler para a ação
      const handler = this.handlers.get(message.action);
      if (!handler) {
        console.warn(`[MessageRouter] No handler for action: ${message.action}`);
        sendResponse({ success: false, error: 'Unknown action' });
        return;
      }

      // Executar handler
      const result = await handler(message, sender);
      sendResponse(result);

    } catch (error) {
      console.error(`[MessageRouter] Error handling message ${message.action}:`, error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Configura handlers padrão
   */
  setupDefaultHandlers() {
    // Handler para captura de screenshot
    this.registerHandler('CAPTURE_SCREENSHOT', async (message, sender) => {
      try {
        const screenshot = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {
          format: 'png',
          quality: 90
        });
        
        return { success: true, screenshot };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Handler para validação de entrada
    this.registerHandler('VALIDATE_INPUT', async (message) => {
      try {
        if (typeof ErrorHandler !== 'undefined') {
          const errorHandler = new ErrorHandler();
          const result = errorHandler.validateInput(message.data, message.schema, message.context);
          return { success: result.isValid, errors: result.errors.map(e => e.message) };
        }
        
        return { success: true, errors: [] };
      } catch (error) {
        return { success: false, errors: [error.message] };
      }
    });

    // Handler para teste de conexão Jira
    this.registerHandler('TEST_JIRA_CONNECTION', async (message) => {
      try {
        // Implementar teste de conexão Jira
        const { baseUrl, email, apiToken, projectKey } = message.settings;
        
        const response = await fetch(`${baseUrl}/rest/api/2/project/${projectKey}`, {
          headers: {
            'Authorization': `Basic ${btoa(`${email}:${apiToken}`)}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          return { success: true };
        } else {
          return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
        }
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Handler para limpeza de badge
    this.registerHandler('POPUP_OPENED', async () => {
      try {
        await chrome.action.setBadgeText({ text: '' });
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }
}

// ==================== NOTIFICATION MANAGER ====================

class NotificationManager {
  constructor() {
    this.notificationQueue = [];
    this.isProcessing = false;
    this.maxNotifications = 5; // Máximo de notificações simultâneas
    this.activeNotifications = new Set();
    
    this.setupNotificationHandlers();
  }

  /**
   * Cria notificação
   */
  async createNotification(options) {
    try {
      // Verificar limite de notificações
      if (this.activeNotifications.size >= this.maxNotifications) {
        this.notificationQueue.push(options);
        return;
      }

      const notificationId = `bugspotter_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      await chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: '/icons/icon48.png',
        ...options
      });

      this.activeNotifications.add(notificationId);
      
      // Auto-remover após 10 segundos se não for interativa
      if (!options.requireInteraction) {
        setTimeout(() => {
          this.clearNotification(notificationId);
        }, 10000);
      }

      return notificationId;

    } catch (error) {
      console.error('[NotificationManager] Error creating notification:', error);
      return null;
    }
  }

  /**
   * Remove notificação
   */
  async clearNotification(notificationId) {
    try {
      await chrome.notifications.clear(notificationId);
      this.activeNotifications.delete(notificationId);
      
      // Processar fila se houver notificações pendentes
      if (this.notificationQueue.length > 0) {
        const nextNotification = this.notificationQueue.shift();
        await this.createNotification(nextNotification);
      }

    } catch (error) {
      console.error('[NotificationManager] Error clearing notification:', error);
    }
  }

  /**
   * Configura handlers de notificação
   */
  setupNotificationHandlers() {
    // Handler para clique em notificação
    chrome.notifications.onClicked.addListener((notificationId) => {
      this.handleNotificationClick(notificationId);
    });

    // Handler para fechamento de notificação
    chrome.notifications.onClosed.addListener((notificationId) => {
      this.activeNotifications.delete(notificationId);
    });
  }

  /**
   * Manipula clique em notificação
   */
  async handleNotificationClick(notificationId) {
    try {
      // Abrir popup da extensão
      await chrome.action.openPopup();
      
      // Limpar notificação
      await this.clearNotification(notificationId);

    } catch (error) {
      console.error('[NotificationManager] Error handling notification click:', error);
    }
  }

  /**
   * Cria notificação de erro HTTP
   */
  async notifyHTTPError(errorData) {
    const { url, statusCode, method } = errorData;
    const hostname = new URL(url).hostname;

    return await this.createNotification({
      title: 'HTTP Error Detected',
      message: `${method} ${statusCode} - ${hostname}`,
      contextMessage: 'Click to create bug report',
      requireInteraction: false
    });
  }

  /**
   * Cria notificação de relatório de IA
   */
  async notifyAIReport(reportData) {
    return await this.createNotification({
      title: 'AI Analysis Complete',
      message: `Found ${reportData.issuesCount || 0} potential issues`,
      contextMessage: 'Click to view report',
      requireInteraction: true
    });
  }
}

// ==================== TAB MANAGER ====================

class TabManager {
  constructor() {
    this.tabData = new Map();
    this.setupTabHandlers();
  }

  /**
   * Configura handlers de tabs
   */
  setupTabHandlers() {
    // Handler para atualização de tab
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      this.handleTabUpdate(tabId, changeInfo, tab);
    });

    // Handler para remoção de tab
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.handleTabRemoved(tabId);
    });
  }

  /**
   * Manipula atualização de tab
   */
  handleTabUpdate(tabId, changeInfo, tab) {
    try {
      // Atualizar dados da tab
      if (changeInfo.status === 'complete' && tab.url) {
        this.tabData.set(tabId, {
          url: tab.url,
          title: tab.title,
          lastUpdated: Date.now()
        });
      }

    } catch (error) {
      console.error('[TabManager] Error handling tab update:', error);
    }
  }

  /**
   * Manipula remoção de tab
   */
  handleTabRemoved(tabId) {
    try {
      this.tabData.delete(tabId);
    } catch (error) {
      console.error('[TabManager] Error handling tab removal:', error);
    }
  }

  /**
   * Obtém dados da tab
   */
  getTabData(tabId) {
    return this.tabData.get(tabId) || null;
  }

  /**
   * Obtém tab ativa
   */
  async getActiveTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs[0] || null;
    } catch (error) {
      console.error('[TabManager] Error getting active tab:', error);
      return null;
    }
  }
}

// ==================== BADGE MANAGER ====================

class BadgeManager {
  constructor() {
    this.errorCount = 0;
    this.lastUpdate = 0;
    this.updateThrottle = 1000; // 1 segundo
  }

  /**
   * Incrementa contador de erros
   */
  async incrementErrorCount() {
    this.errorCount++;
    await this.updateBadge();
  }

  /**
   * Reseta contador de erros
   */
  async resetErrorCount() {
    this.errorCount = 0;
    await this.updateBadge();
  }

  /**
   * Atualiza badge
   */
  async updateBadge() {
    try {
      // Throttle updates
      const now = Date.now();
      if (now - this.lastUpdate < this.updateThrottle) {
        return;
      }
      this.lastUpdate = now;

      const text = this.errorCount > 0 ? this.errorCount.toString() : '';
      const color = this.errorCount > 10 ? '#ff0000' : '#ff6600';

      await chrome.action.setBadgeText({ text });
      await chrome.action.setBadgeBackgroundColor({ color });

    } catch (error) {
      console.error('[BadgeManager] Error updating badge:', error);
    }
  }
}

// ==================== EXPORTAÇÃO ====================

// Exportar classes para uso global
if (typeof window !== 'undefined') {
  window.HTTPErrorHandler = HTTPErrorHandler;
  window.MessageRouter = MessageRouter;
  window.NotificationManager = NotificationManager;
  window.TabManager = TabManager;
  window.BadgeManager = BadgeManager;
}

// Exportar para módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    HTTPErrorHandler,
    MessageRouter,
    NotificationManager,
    TabManager,
    BadgeManager
  };
}