/**
 * Background Script Refatorado - BugSpotter Extension
 * Utiliza módulos especializados para melhor organização
 */

// ==================== IMPORTS E INICIALIZAÇÃO ====================

// Importar módulos especializados
try {
  importScripts(
    '/src/background/BackgroundModules.js',
    '/src/services/ErrorHandler.js',
    '/src/storage/StorageInterface.js'
  );
} catch (error) {
  console.error('[Background] Error importing modules:', error);
}

// ==================== CLASSE PRINCIPAL ====================

class BugSpotterBackground {
  constructor() {
    this.isInitialized = false;
    this.modules = {};
    this.settings = {};
    
    // Inicializar
    this.initialize();
  }

  /**
   * Inicializa o background script
   */
  async initialize() {
    try {
      console.log('[Background] Initializing BugSpotter Background...');
      
      // Inicializar módulos especializados
      await this.initializeModules();
      
      // Carregar configurações
      await this.loadSettings();
      
      // Configurar listeners
      this.setupListeners();
      
      // Configurar interceptação de requests
      this.setupRequestInterception();
      
      this.isInitialized = true;
      console.log('[Background] BugSpotter Background initialized successfully');
      
    } catch (error) {
      console.error('[Background] Error initializing:', error);
    }
  }

  /**
   * Inicializa módulos especializados
   */
  async initializeModules() {
    try {
      // Inicializar módulos se disponíveis
      if (typeof HTTPErrorHandler !== 'undefined') {
        this.modules.httpErrorHandler = new HTTPErrorHandler();
      }
      
      if (typeof MessageRouter !== 'undefined') {
        this.modules.messageRouter = new MessageRouter();
        this.setupCustomMessageHandlers();
      }
      
      if (typeof NotificationManager !== 'undefined') {
        this.modules.notificationManager = new NotificationManager();
      }
      
      if (typeof TabManager !== 'undefined') {
        this.modules.tabManager = new TabManager();
      }
      
      if (typeof BadgeManager !== 'undefined') {
        this.modules.badgeManager = new BadgeManager();
      }
      
      // Inicializar StorageInterface se disponível
      if (typeof StorageInterface !== 'undefined') {
        this.modules.storage = new StorageInterface();
        await this.modules.storage.initialize();
      }
      
      console.log('[Background] Modules initialized:', Object.keys(this.modules));
      
    } catch (error) {
      console.error('[Background] Error initializing modules:', error);
    }
  }

  /**
   * Carrega configurações
   */
  async loadSettings() {
    try {
      if (this.modules.storage) {
        this.settings = await this.modules.storage.getSettings() || {};
      } else {
        // Fallback para chrome.storage
        const result = await chrome.storage.local.get(['settings']);
        this.settings = result.settings || {};
      }
      
      console.log('[Background] Settings loaded');
      
    } catch (error) {
      console.error('[Background] Error loading settings:', error);
      this.settings = {};
    }
  }

  /**
   * Configura listeners principais
   */
  setupListeners() {
    // Listener para mensagens
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Manter canal aberto para resposta assíncrona
    });

    // Listener para instalação/atualização
    chrome.runtime.onInstalled.addListener((details) => {
      this.handleInstallation(details);
    });

    // Listener para startup
    chrome.runtime.onStartup.addListener(() => {
      this.handleStartup();
    });

    // Listener para mudanças no storage
    chrome.storage.onChanged.addListener((changes, namespace) => {
      this.handleStorageChange(changes, namespace);
    });
  }

  /**
   * Configura interceptação de requests HTTP
   */
  setupRequestInterception() {
    try {
      // Listener para requests completados
      chrome.webRequest.onCompleted.addListener(
        (details) => this.handleRequestCompleted(details),
        { urls: ['<all_urls>'] },
        ['responseHeaders']
      );

      // Listener para erros de request
      chrome.webRequest.onErrorOccurred.addListener(
        (details) => this.handleRequestError(details),
        { urls: ['<all_urls>'] }
      );

    } catch (error) {
      console.error('[Background] Error setting up request interception:', error);
    }
  }

  /**
   * Configura handlers customizados para o MessageRouter
   */
  setupCustomMessageHandlers() {
    if (!this.modules.messageRouter) return;

    // Handler para captura de DOM
    this.modules.messageRouter.registerHandler('CAPTURE_DOM', async (message, sender) => {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: sender.tab.id },
          function: () => {
            return {
              html: document.documentElement.outerHTML,
              url: window.location.href,
              title: document.title,
              timestamp: Date.now()
            };
          }
        });

        return { success: true, dom: results[0].result };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Handler para captura de logs do console
    this.modules.messageRouter.registerHandler('CAPTURE_LOGS', async (message, sender) => {
      try {
        // Implementar captura de logs se necessário
        return { success: true, logs: [] };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Handler para envio de bug para Jira
    this.modules.messageRouter.registerHandler('SEND_TO_JIRA', async (message) => {
      return await this.sendBugToJira(message.bugData);
    });

    // Handler para análise de IA
    this.modules.messageRouter.registerHandler('ANALYZE_WITH_AI', async (message) => {
      return await this.analyzeWithAI(message.data);
    });
  }

  /**
   * Manipula mensagens recebidas
   */
  async handleMessage(message, sender, sendResponse) {
    try {
      // Usar MessageRouter se disponível
      if (this.modules.messageRouter) {
        await this.modules.messageRouter.handleMessage(message, sender, sendResponse);
        return;
      }

      // Fallback para handlers básicos
      await this.handleMessageFallback(message, sender, sendResponse);

    } catch (error) {
      console.error('[Background] Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Fallback para manipulação de mensagens
   */
  async handleMessageFallback(message, sender, sendResponse) {
    switch (message.action) {
      case 'CAPTURE_SCREENSHOT':
        try {
          const screenshot = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {
            format: 'png',
            quality: 90
          });
          sendResponse({ success: true, screenshot });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;

      case 'POPUP_OPENED':
        if (this.modules.badgeManager) {
          await this.modules.badgeManager.resetErrorCount();
        } else {
          await chrome.action.setBadgeText({ text: '' });
        }
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
  }

  /**
   * Manipula instalação/atualização da extensão
   */
  async handleInstallation(details) {
    try {
      console.log('[Background] Extension installed/updated:', details.reason);
      
      if (details.reason === 'install') {
        // Primeira instalação
        await this.setupDefaultSettings();
        
        // Mostrar página de boas-vindas
        await chrome.tabs.create({
          url: chrome.runtime.getURL('/src/ui/welcome.html')
        });
      }
      
    } catch (error) {
      console.error('[Background] Error handling installation:', error);
    }
  }

  /**
   * Manipula startup da extensão
   */
  async handleStartup() {
    try {
      console.log('[Background] Extension startup');
      
      // Recarregar configurações
      await this.loadSettings();
      
      // Limpar badge
      if (this.modules.badgeManager) {
        await this.modules.badgeManager.resetErrorCount();
      }
      
    } catch (error) {
      console.error('[Background] Error handling startup:', error);
    }
  }

  /**
   * Manipula mudanças no storage
   */
  async handleStorageChange(changes, namespace) {
    try {
      if (namespace === 'local' && changes.settings) {
        // Recarregar configurações quando mudarem
        await this.loadSettings();
        console.log('[Background] Settings updated');
      }
      
    } catch (error) {
      console.error('[Background] Error handling storage change:', error);
    }
  }

  /**
   * Manipula requests HTTP completados
   */
  async handleRequestCompleted(details) {
    try {
      // Verificar se é um erro HTTP
      if (details.statusCode >= 400) {
        await this.processHTTPError(details);
      }
      
    } catch (error) {
      console.error('[Background] Error handling completed request:', error);
    }
  }

  /**
   * Manipula erros de request
   */
  async handleRequestError(details) {
    try {
      await this.processHTTPError({
        ...details,
        statusCode: 0, // Network error
        error: details.error
      });
      
    } catch (error) {
      console.error('[Background] Error handling request error:', error);
    }
  }

  /**
   * Processa erro HTTP
   */
  async processHTTPError(details) {
    try {
      // Usar HTTPErrorHandler se disponível
      if (this.modules.httpErrorHandler) {
        await this.modules.httpErrorHandler.processHTTPError(details);
      } else {
        // Fallback básico
        await this.processHTTPErrorFallback(details);
      }
      
      // Atualizar badge
      if (this.modules.badgeManager) {
        await this.modules.badgeManager.incrementErrorCount();
      }
      
    } catch (error) {
      console.error('[Background] Error processing HTTP error:', error);
    }
  }

  /**
   * Fallback para processamento de erro HTTP
   */
  async processHTTPErrorFallback(details) {
    // Verificar se deve notificar
    if (!this.settings.notifications?.enabled || !this.settings.notifications?.httpErrors) {
      return;
    }

    // Filtrar erros irrelevantes
    if (details.url.startsWith('chrome-extension://') || details.url.startsWith('moz-extension://')) {
      return;
    }

    // Criar notificação básica
    try {
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon48.png',
        title: 'HTTP Error Detected',
        message: `${details.method || 'GET'} ${details.statusCode} - ${new URL(details.url).hostname}`,
        requireInteraction: false
      });
    } catch (error) {
      console.error('[Background] Error creating notification:', error);
    }
  }

  /**
   * Envia bug para Jira
   */
  async sendBugToJira(bugData) {
    try {
      const jiraSettings = this.settings.jira;
      
      if (!jiraSettings?.enabled || !jiraSettings?.baseUrl) {
        return { success: false, error: 'Jira not configured' };
      }

      // Preparar dados do issue
      const issueData = {
        fields: {
          project: { key: jiraSettings.projectKey },
          summary: bugData.title,
          description: this.formatJiraDescription(bugData),
          issuetype: { name: 'Bug' },
          priority: { name: bugData.priority || 'Medium' }
        }
      };

      // Enviar para Jira
      const response = await fetch(`${jiraSettings.baseUrl}/rest/api/2/issue`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(`${jiraSettings.email}:${jiraSettings.apiToken}`)}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(issueData)
      });

      if (response.ok) {
        const result = await response.json();
        return { success: true, issueKey: result.key, issueUrl: `${jiraSettings.baseUrl}/browse/${result.key}` };
      } else {
        const error = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${error}` };
      }

    } catch (error) {
      console.error('[Background] Error sending to Jira:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Formata descrição para Jira
   */
  formatJiraDescription(bugData) {
    let description = `*Bug Report*\n\n`;
    description += `*Description:* ${bugData.description}\n\n`;
    description += `*URL:* ${bugData.url}\n`;
    description += `*Environment:* ${bugData.environment}\n`;
    description += `*Timestamp:* ${new Date(bugData.timestamp).toISOString()}\n\n`;
    
    if (bugData.steps && bugData.steps.length > 0) {
      description += `*Steps to Reproduce:*\n`;
      const cleanStepPrefix = (s) => (s || '')
        .replace(/^\s*(?:(?:\(\d+\)|\d+\s*[\.\)\-–—])\s*)?(?:[-•*]\s*)?/, '')
        .trim();
      bugData.steps.forEach((step, index) => {
        description += `${index + 1}. ${cleanStepPrefix(step)}\n`;
      });
      description += `\n`;
    }
    
    if (bugData.attachments && bugData.attachments.length > 0) {
      description += `*Attachments:* ${bugData.attachments.length} file(s)\n`;
    }
    
    return description;
  }

  /**
   * Analisa dados com IA
   */
  async analyzeWithAI(data) {
    try {
      // Implementar análise de IA
      // Esta funcionalidade será integrada com o AIService
      console.log('[Background] AI analysis requested:', data);
      
      return { success: true, analysis: 'AI analysis not implemented yet' };
      
    } catch (error) {
      console.error('[Background] Error analyzing with AI:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Configura configurações padrão
   */
  async setupDefaultSettings() {
    try {
      const defaultSettings = {
        jira: {
          enabled: false,
          baseUrl: '',
          email: '',
          apiToken: '',
          projectKey: ''
        },
        capture: {
          screenshotFormat: 'png',
          screenshotQuality: 90,
          maxVideoLength: 30,
          includeConsoleLog: true,
          includeDOMSnapshot: true
        },
        notifications: {
          enabled: true,
          httpErrors: true,
          errorThreshold: 400
        },
        ai: {
          enabled: false,
          autoNotify: false,
          provider: 'openai'
        },
        security: {
          encryptSensitiveData: true,
          autoDeleteAfterDays: 30
        }
      };

      if (this.modules.storage) {
        await this.modules.storage.setSettings(defaultSettings);
      } else {
        await chrome.storage.local.set({ settings: defaultSettings });
      }

      this.settings = defaultSettings;
      console.log('[Background] Default settings configured');
      
    } catch (error) {
      console.error('[Background] Error setting up default settings:', error);
    }
  }
}

// ==================== INICIALIZAÇÃO ====================

// Inicializar background script
const bugSpotterBackground = new BugSpotterBackground();

// Exportar para uso global
if (typeof window !== 'undefined') {
  window.bugSpotterBackground = bugSpotterBackground;
}

console.log('[Background] BugSpotter Background Script loaded');