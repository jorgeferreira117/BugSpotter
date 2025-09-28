// Importar módulos - Manifest V3 compatível
importScripts('../modules/SecurityManager.js');
importScripts('../modules/ErrorHandler.js');
importScripts('../modules/StorageManager.js');
importScripts('../modules/AIService.js');
importScripts('../utils/RateLimiter.js');
importScripts('../utils/PerformanceMonitor.js');

// Remover classes duplicadas - agora importadas dos módulos
// SecurityManager, ErrorHandler, StorageManager e RateLimiter são importados

class BugSpotterBackground {
  constructor() {
    this.rateLimiter = new RateLimiter();
    // Adicionar gerenciamento de sessões debugger
    this.debuggerSessions = new Map();
    // Adicionar logs persistentes por aba
    this.persistentLogs = new Map();
    // Definir limite de logs por aba
    this.maxLogsPerTab = 200; // Reduzido de 1000 para 200
    
    // 🆕 Sistema de deduplicação de logs
    this.recentLogs = new Map(); // Armazena logs recentes por tabId
    this.logDeduplicationWindow = 5000; // 5 segundos para considerar duplicata
    
    // 🆕 Sistema de badge para relatórios AI não lidos
    this.unreadAIReports = 0;
    this.badgeUpdateTimeout = null;
    
    // 🆕 Sistema de deduplicação de erros para IA (específico para pp.daloop.app)
    this.processedAIErrors = new Map(); // Cache em memória para performance
    this.aiErrorTTL = 24 * 60 * 60 * 1000; // 24 horas
    this.processedErrorsStorageKey = 'processedAIErrors'; // Chave para persistência
    
    // ✅ Sistema de rastreamento de aba atual
    this.currentTabId = null;
    
    // 🆕 Sistema de persistência de estado de gravação
    this.recordingStates = new Map(); // Armazena estado de gravação por tabId
    this.recordingStorageKey = 'activeRecordings';
    
    // Inicializar módulos de forma compatível com Manifest V3
    this.initializeModules();
    this.cleanupInterval = null;
    
    // 🆕 Inicializar de forma assíncrona para carregar dados do storage
    this.init().catch(error => {
      console.error('[Background] Erro na inicialização:', error);
    });
  }

  initializeModules() {
    // Inicializar módulos diretamente
    this.securityManager = new SecurityManager();
    this.errorHandler = new ErrorHandler();
    this.storageManager = new StorageManager();
    this.aiService = new AIService();
    this.performanceMonitor = new PerformanceMonitor();
    
    // Flag para controlar se AIService está pronto
    this.aiServiceReady = false;
    
    // Inicializar AIService de forma assíncrona
    this.aiService.initialize()
      .then(() => {
        this.aiServiceReady = true;
      })
      .catch(error => {
        console.error('[Background] Erro ao inicializar AIService:', error);
        this.aiServiceReady = false;
      });
  }

  async init() {
    this.setupEventListeners();
    this.setupContextMenus();
    this.setupDebuggerListeners();
    
    // 🆕 Carregar erros processados do storage
    await this.loadProcessedErrorsFromStorage();
    
    // 🆕 Carregar estados de gravação do storage
    await this.loadRecordingStatesFromStorage();
    
    // 🆕 Inicializar badge com estado correto
    await this.updateBadge();
    console.log('[Background] Badge inicializado na inicialização');
    
    // Cleanup quando a extensão é descarregada
    chrome.runtime.onSuspend.addListener(() => {
      this.cleanup();
    });
  }

  setupEventListeners() {
    // Listener para instalação da extensão
    chrome.runtime.onInstalled.addListener((details) => {
      if (details.reason === 'install') {
        this.onFirstInstall();
      }
    });

    // Listener para mensagens do content script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Indica resposta assíncrona
    });

    // Listener para mudanças de aba
    chrome.tabs.onActivated.addListener((activeInfo) => {
      this.onTabActivated(activeInfo);
    });

    // Listener para atualizações de aba
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete') {
        this.onTabCompleted(tabId, tab);
      }
    });

    // Listener para quando aba é fechada - cleanup debugger
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.cleanupDebuggerSession(tabId);
    });
    
    // Limpar logs quando aba é fechada
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.cleanupTabData(tabId);
    });
    
    // ✅ Limpar currentTabId quando aba atual é fechada
    chrome.tabs.onRemoved.addListener((removedTabId) => {
      if (removedTabId === this.currentTabId) {
        console.log(`[Background] Aba atual ${removedTabId} foi fechada, limpando ID`);
        this.currentTabId = null;
      }
    });
    
    // Limpar logs antigos periodicamente com referência armazenada
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldLogs();
      this.optimizeStorage();
    }, 5 * 60 * 1000); // A cada 5 minutos
  }
  
  cleanupTabData(tabId) {
    // Iniciando limpeza de dados - silenciado
    
    // Verificar se há dados para limpar
    const hasDebuggerSession = this.debuggerSessions.has(tabId);
    const hasPersistentLogs = this.persistentLogs.has(tabId);
    
    if (hasDebuggerSession || hasPersistentLogs) {
      // Status da tab - silenciado
    }
    
    // Cleanup completo dos dados da aba
    this.debuggerSessions.delete(tabId);
    
    // Preservar logs persistentes por mais tempo (opcional)
    // this.persistentLogs.delete(tabId);
    
    // Desanexar debugger se ainda estiver anexado
    try {
      if (chrome.debugger && hasDebuggerSession) {
        chrome.debugger.detach({ tabId });
        // Debugger desanexado - silenciado
      }
    } catch (error) {
      // Tratamento específico para erro de tab inexistente
      if (error.message && error.message.includes('No tab with given id')) {
        // Tab já foi fechada - silenciado
      } else {
        // Erro ao desanexar debugger - silenciado
      }
    }
    
    // Limpeza concluída - silenciado
  }

  // Função auxiliar para verificar se uma aba existe
  async tabExists(tabId) {
    try {
      await chrome.tabs.get(tabId);
      return true;
    } catch (error) {
      if (error.message && error.message.includes('No tab with given id')) {
        return false;
      }
      throw error; // Re-throw outros tipos de erro
    }
  }
  
  async optimizeStorage() {
    try {
      // Gerar relatório de uso de storage
      const report = await this.storageManager.generateReport();
      
      // Se o uso estiver alto (>80%), fazer limpeza agressiva
      if (report.usage > 0.8) {
        // Alto uso de storage detectado - silenciado
        
        // Limpar dados antigos mais agressivamente
        const aggressiveCutoff = Date.now() - (3 * 24 * 60 * 60 * 1000); // 3 dias
        
        for (const [tabId, data] of this.persistentLogs.entries()) {
          if (data.timestamp && data.timestamp < aggressiveCutoff) {
            this.persistentLogs.delete(tabId);
          }
        }
        
        // Forçar limpeza do StorageManager
        await this.storageManager.cleanup(true);
      }
      
      // Log do status do storage
      if (report.usage > 0.5) {
        // Storage usage - silenciado
      }
    } catch (error) {
      this.errorHandler.handleError(error, 'optimizeStorage');
    }
  }

  // Método de cleanup centralizado
  cleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Desanexar todos os debuggers ativos
    for (const tabId of this.debuggerSessions.keys()) {
      try {
        chrome.debugger.detach({ tabId });
      } catch (error) {
        // Ignorar erros
      }
    }
    
    // Limpar todos os Maps
    this.debuggerSessions.clear();
    this.persistentLogs.clear();
    this.recentLogs.clear();
    
    // 🆕 Limpar cache de erros processados pela IA
    this.processedAIErrors.clear();
    
    // Fazer limpeza final do storage
    if (this.storageManager) {
      this.storageManager.cleanup().catch(console.error);
    }
  }
  
  async cleanupOldLogs() {
    try {
      // Usar StorageManager para limpeza automática
      const cleanupStats = await this.storageManager.cleanup();
      
      // ✅ NOVO: Limpar logs persistentes de tabs fechadas há muito tempo
      const tabCleanupTime = Date.now() - (2 * 60 * 60 * 1000); // 2 horas atrás
      const closedTabsToCleanup = [];
      
      for (const [tabId, persistentData] of this.persistentLogs.entries()) {
        // Verificar se a tab ainda existe
        const tabExists = await this.tabExists(tabId);
        if (!tabExists) {
          // Se a tab não existe há mais de 2 horas, marcar para limpeza
          const lastActivity = persistentData.logs.length > 0 ? 
            Math.max(...persistentData.logs.map(log => new Date(log.timestamp).getTime())) : 0;
          
          if (lastActivity < tabCleanupTime) {
            closedTabsToCleanup.push(tabId);
          }
        }
      }
      
      // Limpar dados de tabs fechadas
      for (const tabId of closedTabsToCleanup) {
        const persistentData = this.persistentLogs.get(tabId);
        const logCount = persistentData?.logs?.length || 0;
        this.persistentLogs.delete(tabId);
        // Removidos logs persistentes - silenciado
      }
      
      // Limpeza adicional de dados em memória
      const maxAge = 15 * 60 * 1000; // Reduzido de 30 para 15 minutos
      const now = Date.now();
      
      for (const [tabId, data] of this.persistentLogs.entries()) {
        // Remover logs muito antigos
        data.logs = data.logs.filter(log => {
          const logTime = new Date(log.timestamp).getTime();
          return (now - logTime) < maxAge;
        });
        
        // Limpar também networkRequests e errors
        if (data.networkRequests) {
          data.networkRequests = data.networkRequests.filter(req => {
            const reqTime = new Date(req.timestamp).getTime();
            return (now - reqTime) < maxAge;
          });
        }
        
        if (data.errors) {
          data.errors = data.errors.filter(error => {
            const errorTime = new Date(error.timestamp).getTime();
            return (now - errorTime) < maxAge;
          });
        }
        
        // Se não há logs, remover a entrada
        if (data.logs.length === 0 && 
            (!data.networkRequests || data.networkRequests.length === 0) &&
            (!data.errors || data.errors.length === 0)) {
          this.persistentLogs.delete(tabId);
        }
      }
      
      // ✅ NOVO: Log de estatísticas de limpeza
      const activeSessionsCount = this.debuggerSessions.size;
      const persistentLogsCount = this.persistentLogs.size;
      // Estatísticas de limpeza - silenciado
      // Limpeza automática - silenciado
      
    } catch (error) {
      this.errorHandler.handleError(error, 'cleanupOldLogs');
    }
  }

  // Nova função para configurar listeners do debugger
  setupDebuggerListeners() {
    if (chrome.debugger && chrome.debugger.onEvent) {
      chrome.debugger.onEvent.addListener((source, method, params) => {
        this.handleDebuggerEvent(source, method, params);
      });

      chrome.debugger.onDetach.addListener((source, reason) => {
        // Debugger detached - silenciado
        this.debuggerSessions.delete(source.tabId);
      });
    } else {
      console.warn('Chrome debugger API not available. Some features may not work.');
    }
  }

  // Gerenciar eventos do debugger com buffer circular
  handleDebuggerEvent(source, method, params) {
    const tabId = source.tabId;
    const session = this.debuggerSessions.get(tabId);
    const persistentData = this.getPersistentLogs(tabId);
    const timestamp = Date.now();
  
    if (!session || !persistentData) {
      console.warn(`[DEBUG] Sessão ou dados persistentes não encontrados para aba ${tabId}`);
      return;
    }
  
    switch (method) {
      case 'Console.messageAdded':
        const consoleEntry = {
          type: 'console',
          level: params.message.level,
          text: params.message.text,
          timestamp: new Date(timestamp).toISOString(),
          url: params.message.url,
          line: params.message.line,
          column: params.message.column
        };
        
        // Console.messageAdded capturado - silenciado
        
        this.addToBuffer(session.logs, consoleEntry);
        this.addToBuffer(persistentData.logs, consoleEntry);
  
        if (consoleEntry.level === 'error') {
          this.addToBuffer(persistentData.errors, consoleEntry);
        }
        break;
  
      case 'Runtime.consoleAPICalled':
        const apiEntry = {
          type: 'console-api',
          level: params.type || 'log',
          text: params.args ? params.args.map(arg => {
            if (arg.value !== undefined) return String(arg.value);
            if (arg.description !== undefined) return arg.description;
            if (arg.unserializableValue !== undefined) return arg.unserializableValue;
            if (arg.objectId) return '[Object]';
            return JSON.stringify(arg);
          }).join(' ') : '',
          timestamp: new Date(timestamp).toISOString(),
          stackTrace: params.stackTrace,
          executionContextId: params.executionContextId
        };
        
        // Detectar erros em console.error() e console.warn()
        if (params.type === 'error' || params.type === 'assert') {
          apiEntry.level = 'error';
        }
        
        // Runtime.consoleAPICalled capturado - silenciado
        
        this.addToBuffer(session.logs, apiEntry);
        this.addToBuffer(persistentData.logs, apiEntry);
  
        // Se for erro, adicionar à lista de erros
        if (apiEntry.level === 'error') {
          this.addToBuffer(persistentData.errors, apiEntry);
        }
        break;
  
      case 'Runtime.exceptionThrown':
        const errorEntry = {
          type: 'exception',
          level: 'error',
          text: params.exceptionDetails.text || 'Runtime Exception',
          timestamp: new Date(timestamp).toISOString(),
          stackTrace: params.exceptionDetails.stackTrace,
          url: params.exceptionDetails.url,
          lineNumber: params.exceptionDetails.lineNumber,
          columnNumber: params.exceptionDetails.columnNumber
        };
        
        // Runtime.exceptionThrown capturado - silenciado
        
        this.addToBuffer(session.logs, errorEntry);
        this.addToBuffer(persistentData.logs, errorEntry);
        this.addToBuffer(persistentData.errors, errorEntry);
        break;
  
      // 🆕 NOVOS CASOS PARA EVENTOS DE REDE
      case 'Network.requestWillBeSent':
        const requestEntry = {
          type: 'network-request',
          method: params.request.method,
          url: params.request.url,
          timestamp: new Date(timestamp).toISOString(),
          requestId: params.requestId,
          headers: params.request.headers,
          postData: params.request.postData,
          initiator: params.initiator,
          // 🆕 Adicionar log formatado para exibição
          text: `[NETWORK] ${params.request.method} ${params.request.url}`
        };
        
        // Network.requestWillBeSent capturado - silenciado
        
        this.addToBuffer(session.networkRequests, requestEntry);
        this.addToBuffer(persistentData.networkRequests, requestEntry);
        
        // 🆕 Também adicionar aos logs gerais para aparecer no arquivo de texto
        this.addToBuffer(session.logs, requestEntry);
        this.addToBuffer(persistentData.logs, requestEntry);
        break;
  
      case 'Network.responseReceived':
        const responseEntry = {
          type: 'network-response',
          url: params.response.url,
          status: params.response.status,
          statusText: params.response.statusText,
          timestamp: new Date(timestamp).toISOString(),
          requestId: params.requestId,
          headers: params.response.headers,
          mimeType: params.response.mimeType
        };
        
        // Network.responseReceived capturado - silenciado
        
        // 🆕 NOVO: Capturar corpo da resposta para erros HTTP
        if (params.response.status >= 400) {
          // 🆕 Verificar se é um log duplicado antes de processar
          const isDuplicate = this.isHttpLogDuplicate(
            tabId,
            params.response.url,
            params.response.status,
            responseEntry.timestamp
          );
          
          if (isDuplicate) {
            // Log duplicado detectado - não processar via debugger
            break;
          }
          
          try {
            // Verificar se a API debugger está disponível
            if (!chrome.debugger) {
              console.warn('Chrome debugger API not available for Network.getResponseBody');
              return;
            }
            
            // Obter o corpo da resposta para erros
            chrome.debugger.sendCommand({tabId}, "Network.getResponseBody", {
              requestId: params.requestId
            }).then((responseBody) => {
              const errorWithBody = {
                type: 'http-error-with-body',
                level: 'error',
                text: `[HTTP ERROR] ${params.response.status} ${params.response.statusText} - ${params.response.url}`,
                timestamp: responseEntry.timestamp,
                url: params.response.url,
                status: params.response.status,
                statusText: params.response.statusText,
                responseBody: responseBody.body,
                base64Encoded: responseBody.base64Encoded
              };
              
              // Decodificar se necessário
              if (responseBody.base64Encoded) {
                try {
                  errorWithBody.decodedBody = atob(responseBody.body);
                } catch (e) {
                  errorWithBody.decodedBody = 'Could not decode base64 response';
                }
              } else {
                errorWithBody.decodedBody = responseBody.body;
              }
              
              // Adicionar log detalhado com corpo da resposta
              const detailedErrorLog = {
                ...errorWithBody,
                text: `[HTTP ERROR] ${params.response.status} ${params.response.statusText} - ${params.response.url}\nResponse Body: ${errorWithBody.decodedBody}`
              };
              
              // HTTP Error com corpo capturado - silenciado
              
              // Adicionar aos logs de erro
              const session = this.debuggerSessions.get(tabId);
              const persistentData = this.getPersistentLogs(tabId);
              
              if (session) {
                this.addToBuffer(session.logs, detailedErrorLog);
              }
              if (persistentData) {
                this.addToBuffer(persistentData.logs, detailedErrorLog);
                this.addToBuffer(persistentData.errors, detailedErrorLog);
              }
              
              // Enviar notificação de erro HTTP
              this.sendErrorNotification(detailedErrorLog, tabId).catch(error => {
                console.error('[Background] Erro ao enviar notificação:', error);
              });

              // 🆕 Processar erro com AI se configurado
              this.processErrorWithAI(detailedErrorLog, tabId).catch(error => {
                console.error('[Background] Erro ao processar com AI:', error);
              });
              
            }).catch((error) => {
              // ✅ Tratar especificamente o erro 'No tab with given id'
              if (error.message && error.message.includes('No tab with given id')) {
                console.log(`[Background] Aba ${tabId} não existe mais, pulando Network.getResponseBody para ${params.requestId}`);
                return; // Sair silenciosamente quando a aba não existe
              }
              console.warn(`[DEBUG] Não foi possível obter corpo da resposta para ${params.requestId}:`, error);
              
              // Fallback: adicionar erro sem corpo da resposta
              // Encontrar a requisição original para obter o método HTTP
              const originalRequest = session?.networkRequests?.find(req => req.requestId === params.requestId) ||
                                    persistentData?.networkRequests?.find(req => req.requestId === params.requestId);
              
              const basicError = {
                type: 'http-error',
                level: 'error',
                text: `[HTTP ERROR] ${originalRequest?.method || 'UNKNOWN'} ${params.response.status} ${params.response.statusText} - ${params.response.url}`,
                timestamp: responseEntry.timestamp,
                url: params.response.url,
                method: originalRequest?.method || 'GET', // Incluir método HTTP
                status: params.response.status,
                statusText: params.response.statusText,
                note: 'Response body could not be retrieved'
              };
              
              if (session) {
                this.addToBuffer(session.logs, basicError);
              }
              if (persistentData) {
                this.addToBuffer(persistentData.logs, basicError);
                this.addToBuffer(persistentData.errors, basicError);
              }
              
              // Enviar notificação de erro HTTP
              this.sendErrorNotification(basicError, tabId).catch(error => {
                console.error('[Background] Erro ao enviar notificação:', error);
              });

              // 🆕 Processar erro com AI se configurado
              this.processErrorWithAI(basicError, tabId).catch(error => {
                console.error('[Background] Erro ao processar com AI:', error);
              });
            });
          } catch (error) {
            console.error(`[DEBUG] Erro ao tentar obter corpo da resposta:`, error);
          }
        }
        
        // Encontrar a requisição correspondente e atualizar
        const requestIndex = session.networkRequests.findIndex(req => req.requestId === params.requestId);
        if (requestIndex !== -1) {
          const originalRequest = session.networkRequests[requestIndex];
          const combinedEntry = {
            ...originalRequest,
            ...responseEntry,
            text: `[NETWORK] ${originalRequest.method} ${params.response.status} ${params.response.statusText} - ${params.response.url}`,
            level: params.response.status >= 400 ? 'error' : 'info'
          };
          
          session.networkRequests[requestIndex] = combinedEntry;
          
          const logIndex = session.logs.findIndex(log => log.requestId === params.requestId);
          if (logIndex !== -1) {
            session.logs[logIndex] = combinedEntry;
          }
        }
        
        const persistentIndex = persistentData.networkRequests.findIndex(req => req.requestId === params.requestId);
        if (persistentIndex !== -1) {
          const originalRequest = persistentData.networkRequests[persistentIndex];
          const combinedEntry = {
            ...originalRequest,
            ...responseEntry,
            text: `[NETWORK] ${originalRequest.method} ${params.response.status} ${params.response.statusText} - ${params.response.url}`,
            level: params.response.status >= 400 ? 'error' : 'info'
          };
          
          persistentData.networkRequests[persistentIndex] = combinedEntry;
          
          const persistentLogIndex = persistentData.logs.findIndex(log => log.requestId === params.requestId);
          if (persistentLogIndex !== -1) {
            persistentData.logs[persistentLogIndex] = combinedEntry;
          }
        }
        
        // Tratar status codes de erro (4xx, 5xx) como logs de erro
        if (params.response.status >= 400) {
          const httpError = {
            type: 'http-error',
            level: 'error',
            text: `[HTTP ERROR] ${params.response.status} ${params.response.statusText} - ${params.response.url}`,
            timestamp: responseEntry.timestamp,
            url: params.response.url,
            status: params.response.status,
            statusText: params.response.statusText
          };
          
          this.addToBuffer(persistentData.errors, httpError);
        }
        break;
  
      case 'Network.loadingFailed':
        const failedEntry = {
          type: 'network-failed',
          url: params.request?.url || 'Unknown URL',
          timestamp: new Date(timestamp).toISOString(),
          requestId: params.requestId,
          errorText: params.errorText,
          canceled: params.canceled
        };
        
        // Network.loadingFailed capturado - silenciado
        
        this.addToBuffer(session.networkRequests, failedEntry);
        this.addToBuffer(persistentData.networkRequests, failedEntry);
        
        // Também adicionar como erro se for uma falha de rede
        if (!params.canceled) {
          const networkError = {
            type: 'network-error',
            level: 'error',
            text: `Network request failed: ${params.errorText} - ${failedEntry.url}`,
            timestamp: failedEntry.timestamp
          };
          this.addToBuffer(persistentData.errors, networkError);
        }
        break;
  
      case 'Network.loadingFinished':
        const finishedEntry = {
          type: 'network-finished',
          timestamp: new Date(timestamp).toISOString(),
          requestId: params.requestId,
          encodedDataLength: params.encodedDataLength
        };
        
        // Network.loadingFinished capturado - silenciado
        
        // Atualizar a requisição correspondente com informações de conclusão
        const finishedRequestIndex = session.networkRequests.findIndex(req => req.requestId === params.requestId);
        if (finishedRequestIndex !== -1) {
          session.networkRequests[finishedRequestIndex] = { ...session.networkRequests[finishedRequestIndex], ...finishedEntry };
        }
        
        const finishedPersistentIndex = persistentData.networkRequests.findIndex(req => req.requestId === params.requestId);
        if (finishedPersistentIndex !== -1) {
          persistentData.networkRequests[finishedPersistentIndex] = { ...persistentData.networkRequests[finishedPersistentIndex], ...finishedEntry };
        }
        break;
  
      default:
        // Evento debugger não tratado - silenciado
        break;
    }
  }

  addToBuffer(array, item) {
    array.push(item);
    // Usar limite mais conservador para melhor performance
    const limit = this.maxLogsPerTab || 200;
    if (array.length > limit) {
      // Remove múltiplos itens de uma vez se necessário
      const excess = array.length - limit;
      array.splice(0, excess);
    }
  }

  // Método para obter logs persistentes
  getPersistentLogs(tabId) {
    return this.persistentLogs.get(tabId) || {
      logs: [],
      networkRequests: [],
      errors: []
    };
  }

  // Anexar debugger a uma aba
  async attachDebugger(tabId) {
    return await this.errorHandler.executeWithRetry(async () => {
      // Verificar se a API debugger está disponível
      if (!chrome.debugger) {
        console.warn('Chrome debugger API not available');
        return { success: false, message: 'Debugger API not available' };
      }

      // Verificar se a aba ainda existe
      const tabStillExists = await this.tabExists(tabId);
      if (!tabStillExists) {
        // Aba não existe mais - silenciado
        return { success: false, message: 'Tab no longer exists' };
      }

      // Verificar se já está anexado
      if (this.debuggerSessions.has(tabId)) {
        // Debugger já anexado - silenciado
        return { success: true, message: 'Debugger already attached' };
      }
  
      // Tentando anexar debugger - silenciado
      
      try {
        await chrome.debugger.attach({tabId}, "1.3");
        
        // Habilitar domínios necessários
        await chrome.debugger.sendCommand({tabId}, "Runtime.enable");
        await chrome.debugger.sendCommand({tabId}, "Console.enable");
        await chrome.debugger.sendCommand({tabId}, "Network.enable");
        
        // Configurações avançadas para capturar todos os tipos de logs
        await chrome.debugger.sendCommand({tabId}, "Runtime.setAsyncCallStackDepth", { maxDepth: 32 });
      } catch (debuggerError) {
        // Tratamento específico para erro de tab inexistente durante operações do debugger
        if (debuggerError.message && debuggerError.message.includes('No tab with given id')) {
          // Tab foi fechada durante anexação - silenciado
          return { success: false, message: 'Tab was closed during debugger attachment' };
        }
        throw debuggerError;
      }
      // ❌ REMOVER esta linha que causa o erro:
      // await chrome.debugger.sendCommand({tabId}, "Console.setMonitoringXHREnabled", { enabled: true });
      
      // 🆕 CAPTURAR LOGS EXISTENTES ANTES DE LIMPAR
      let existingLogs = [];
      try {
        // Verificar se a aba ainda existe antes de tentar enviar mensagem
        const tabStillExists = await this.tabExists(tabId);
        if (tabStillExists) {
          // Tentar obter logs do content script primeiro
          const contentLogs = await chrome.tabs.sendMessage(tabId, { action: 'getLogs' });
          if (contentLogs && contentLogs.logs) {
            existingLogs = contentLogs.logs.map(log => ({
              type: 'console-existing',
              level: log.level,
              text: log.message,
              timestamp: log.timestamp,
              url: log.url,
              source: 'content-script'
            }));
            // Logs existentes capturados - silenciado
          }
        } else {
          // Aba não existe mais - silenciado
        }
      } catch (e) {
        // Tratamento específico para erro de tab inexistente
        if (e.message && e.message.includes('No tab with given id')) {
          // Tab foi fechada durante operação - silenciado
        } else {
          // Não foi possível obter logs do content script - silenciado
        }
      }
      
      // Tentar capturar logs do console do navegador
      try {
        if (!chrome.debugger) {
          console.warn('Chrome debugger API not available for Runtime.evaluate');
        } else {
          const consoleResult = await chrome.debugger.sendCommand({tabId}, "Runtime.evaluate", {
          expression: `
            (function() {
              if (window.bugSpotterLogs) {
                return window.bugSpotterLogs;
              }
              // Tentar acessar histórico do console se disponível
              if (console.history) {
                return console.history;
              }
              return [];
            })()
          `,
          returnByValue: true
        });
        
        if (consoleResult.result && consoleResult.result.value) {
          const browserLogs = consoleResult.result.value;
          if (Array.isArray(browserLogs) && browserLogs.length > 0) {
            const formattedBrowserLogs = browserLogs.map(log => ({
              type: 'console-existing',
              level: log.level || 'log',
              text: log.message || String(log),
              timestamp: log.timestamp || new Date().toISOString(),
              url: log.url || '',
              source: 'browser-console'
            }));
            existingLogs = [...existingLogs, ...formattedBrowserLogs];
            // Logs adicionais do browser - silenciado
          }
        }
        }
      } catch (e) {
        // Tratamento específico para erro de tab inexistente
        if (e.message && e.message.includes('No tab with given id')) {
          // Tab foi fechada durante avaliação - silenciado
        } else {
          // Não foi possível obter logs do browser console - silenciado
        }
      }
      
      // 🆕 NÃO LIMPAR CONSOLE - comentar estas linhas para preservar logs
      // try {
      //   await chrome.debugger.sendCommand({tabId}, "Console.clearMessages");
      //   await chrome.debugger.sendCommand({tabId}, "Runtime.discardConsoleEntries");
      // } catch (e) {
      //   console.log('Aviso: Não foi possível limpar console anterior:', e.message);
      // }
      
      // Criar sessão
      this.debuggerSessions.set(tabId, {
        attached: true,
        logs: [...existingLogs], // Incluir logs existentes
        networkRequests: [],
        attachedAt: Date.now()
      });
  
      // Inicializar logs persistentes se não existirem
      if (!this.persistentLogs.has(tabId)) {
        this.persistentLogs.set(tabId, {
          logs: [...existingLogs], // Incluir logs existentes
          networkRequests: [],
          errors: existingLogs.filter(log => log.level === 'error')
        });
      } else {
        // Adicionar logs existentes aos persistentes
        const persistent = this.persistentLogs.get(tabId);
        persistent.logs.unshift(...existingLogs);
        persistent.errors.unshift(...existingLogs.filter(log => log.level === 'error'));
      }
  
      // Debugger anexado com sucesso - silenciado
      return { success: true, message: 'Debugger attached successfully', existingLogs: existingLogs.length };
      
    }, 'Anexar debugger');
  }

  // Desanexar debugger de uma aba
  async detachDebugger(tabId) {
    try {
      if (!chrome.debugger) {
        console.warn('Chrome debugger API not available');
        return;
      }
      
      if (this.debuggerSessions.has(tabId)) {
        await chrome.debugger.detach({tabId});
        this.debuggerSessions.delete(tabId);
        // Debugger detached - silenciado
      }
    } catch (error) {
      // Tratamento específico para erro de tab inexistente
      if (error.message && error.message.includes('No tab with given id')) {
        // Tab já foi fechada - silenciado
        this.debuggerSessions.delete(tabId);
      } else {
        this.errorHandler.handleError(error, 'Desanexar debugger');
      }
    }
  }

  // Cleanup automático de sessão
  cleanupDebuggerSession(tabId) {
    if (this.debuggerSessions.has(tabId)) {
      this.detachDebugger(tabId);
    }
  }

  // Obter logs capturados via debugger
  getDebuggerLogs(tabId, domainFilter = null) {
    const session = this.debuggerSessions.get(tabId);
    const persistentData = this.persistentLogs.get(tabId) || { logs: [], networkRequests: [], errors: [] };
    
    if (!session) {
      // Aplicar filtro se especificado
      const filteredData = domainFilter ? {
        logs: persistentData.logs.filter(log => !log.url || log.url.includes(domainFilter)),
        networkRequests: persistentData.networkRequests.filter(req => req.url.includes(domainFilter)),
        errors: persistentData.errors.filter(err => !err.url || err.url.includes(domainFilter))
      } : persistentData;
      
      return filteredData;
    }
    
    // Combinar logs da sessão atual com logs persistentes
    const combinedLogs = [...persistentData.logs, ...session.logs];
    const combinedNetworkRequests = [...persistentData.networkRequests, ...session.networkRequests];
    const combinedErrors = [...persistentData.errors, ...session.logs.filter(log => log.level === 'error')];
    
    // Aplicar filtro se especificado
    if (domainFilter) {
      return {
        logs: combinedLogs.filter(log => !log.url || log.url.includes(domainFilter)),
        networkRequests: combinedNetworkRequests.filter(req => req.url.includes(domainFilter)),
        errors: combinedErrors.filter(err => !err.url || err.url.includes(domainFilter))
      };
    }
    
    return {
      logs: combinedLogs,
      networkRequests: combinedNetworkRequests,
      errors: combinedErrors
    };
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      // Processar mensagens de erro HTTP do content script
      if (message.type === 'HTTP_ERROR' || message.type === 'NETWORK_ERROR') {
        const tabId = sender.tab?.id;
        if (tabId) {
          // 🆕 Verificar se é um log duplicado antes de processar
          if (message.type === 'HTTP_ERROR') {
            const isDuplicate = this.isHttpLogDuplicate(
              tabId, 
              message.data.url, 
              message.data.status, 
              message.data.timestamp
            );
            
            if (isDuplicate) {
              // Log duplicado detectado - ignorar
              return;
            }
          }
          
          // Adicionar erro aos logs persistentes
          let errorMessage;
          if (message.type === 'HTTP_ERROR') {
            // Incluir corpo da resposta se disponível
            if (message.data.responseBody) {
              const responseInfo = typeof message.data.responseBody === 'object' 
                ? JSON.stringify(message.data.responseBody)
                : message.data.responseBody;
              errorMessage = `HTTP ${message.data.status} ${message.data.statusText} - ${message.data.url} | Response: ${responseInfo}`;
            } else {
              errorMessage = `HTTP ${message.data.status} ${message.data.statusText} - ${message.data.url}`;
            }
          } else {
            errorMessage = `Network Error: ${message.data.error} - ${message.data.url}`;
          }
          
          const errorLog = {
            level: 'error',
            message: errorMessage,
            timestamp: message.data.timestamp,
            source: 'network',
            url: message.data.url,
            status: message.data.status,
            method: message.data.method,
            responseBody: message.data.responseBody,
            responseText: message.data.responseText
          };
          
          // Adicionar aos logs persistentes
          if (!this.persistentLogs.has(tabId)) {
            this.persistentLogs.set(tabId, []);
          }
          this.addToBuffer(this.persistentLogs.get(tabId), errorLog);
          
          // Processar com AI se habilitado
          try {
            await this.processErrorWithAI(errorLog, tabId);
          } catch (aiError) {
            // AI processing failed - silenciado
          }
          
          // Enviar notificação se habilitado
          try {
            await this.sendErrorNotification(errorLog, tabId);
          } catch (notifError) {
            // Notification failed - silenciado
          }
        }
        return;
      }
      
      // Atualizar aba atual se não for um ping
      if (message.action !== 'ping' && sender.tab?.id) {
        this.setCurrentTab(sender.tab.id);
      }
      
      switch (message.action) {
        case 'CAPTURE_SCREENSHOT':
          try {
            const tabId = sender.tab?.id;
            if (!tabId) {
              throw new Error('No tab ID available');
            }
            // ✅ VALIDAR se a tab ainda existe
            const tabExists = await this.tabExists(tabId);
            if (!tabExists) {
              throw new Error(`Tab ${tabId} no longer exists`);
            }
            const screenshot = await this.captureScreenshot(tabId);
            sendResponse({ success: true, data: screenshot });
          } catch (error) {
            // Screenshot failed - silenciado
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'GET_CONSOLE_LOGS':
          try {
            const tabId = sender.tab?.id;
            if (!tabId) {
              throw new Error('No tab ID available');
            }
            // ✅ VALIDAR se a tab ainda existe
            const tabExists = await this.tabExists(tabId);
            if (!tabExists) {
              throw new Error(`Tab ${tabId} no longer exists`);
            }
            const logs = await this.getConsoleLogs(tabId);
            sendResponse({ success: true, data: logs });
          } catch (error) {
            // Get console logs failed - silenciado
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'ATTACH_DEBUGGER':
          try {
            const tabId = message.tabId || sender.tab?.id;
            if (!tabId) {
              throw new Error('No tab ID provided');
            }
            // ✅ VALIDAR se a tab ainda existe
            const tabExists = await this.tabExists(tabId);
            if (!tabExists) {
              throw new Error(`Tab ${tabId} no longer exists`);
            }
            await this.attachDebugger(tabId);
            sendResponse({ success: true });
          } catch (error) {
            // Attach debugger failed - silenciado
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'DETACH_DEBUGGER':
          try {
            const tabId = message.tabId || sender.tab?.id;
            if (!tabId) {
              throw new Error('No tab ID provided');
            }
            // ✅ VALIDAR se a tab ainda existe (opcional para detach)
            const tabExists = await this.tabExists(tabId);
            if (!tabExists) {
              // Tab no longer exists - silenciado
              this.debuggerSessions.delete(tabId);
              sendResponse({ success: true, message: 'Tab closed, session cleaned up' });
              break;
            }
            await this.detachDebugger(tabId);
            sendResponse({ success: true });
          } catch (error) {
            // Detach debugger failed - silenciado
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'GET_DEBUGGER_LOGS':
          try {
            const tabId = message.tabId || sender.tab?.id;
            if (!tabId) {
              throw new Error('No tab ID provided');
            }
            
            // ✅ VALIDAR se a tab ainda existe (opcional para logs)
            const tabExists = await this.tabExists(tabId);
            if (!tabExists) {
              // Tab no longer exists, returning persistent logs - silenciado
              // Retornar apenas logs persistentes se a tab não existir mais
              const persistentLogs = this.getPersistentLogs(tabId);
              const domainFilter = message.domainFilter || null;
              
              const filteredLogs = domainFilter ? {
                logs: persistentLogs.logs.filter(log => !log.url || log.url.includes(domainFilter)),
                networkRequests: persistentLogs.networkRequests.filter(req => req.url.includes(domainFilter)),
                errors: persistentLogs.errors.filter(err => !err.url || err.url.includes(domainFilter))
              } : persistentLogs;
              
              const combinedLogs = {
                logs: filteredLogs.logs,
                networkRequests: filteredLogs.networkRequests,
                errors: filteredLogs.errors,
                totalLogs: filteredLogs.logs.length,
                totalErrors: filteredLogs.errors.length,
                domainFilter: domainFilter,
                tabClosed: true
              };
              
              sendResponse({ success: true, data: combinedLogs });
              break;
            }
            
            // 🆕 Suporte para filtro de domínio
            const domainFilter = message.domainFilter || null;
            const sessionLogs = this.getDebuggerLogs(tabId, domainFilter);
            
            const combinedLogs = {
              logs: sessionLogs.logs,
              networkRequests: sessionLogs.networkRequests,
              errors: sessionLogs.errors,
              totalLogs: sessionLogs.logs.length,
              totalErrors: sessionLogs.errors.length,
              domainFilter: domainFilter,
              tabClosed: false
            };
            
            sendResponse({ success: true, data: combinedLogs });
          } catch (error) {
            // Get debugger logs failed - silenciado
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'SAVE_BUG':
          await this.saveBug(message.data);
          sendResponse({ success: true });
          break;

        case 'SEND_TO_JIRA':
          const jiraResult = await this.sendToJira(message.data);
          sendResponse({ success: true, data: jiraResult });
          break;

        case 'TEST_JIRA_CONNECTION':
          try {
            const jiraConfig = message.config;
            const testResult = await this.testJiraConnection(jiraConfig);
            sendResponse({ success: true, data: testResult });
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'VALIDATE_INPUT':
          try {
            const validation = this.errorHandler.validateInput(
              message.data, 
              message.schema, 
              message.context || 'Input Validation'
            );
            sendResponse({ 
              success: validation.isValid, 
              errors: validation.errors 
            });
          } catch (error) {
            sendResponse({ 
              success: false, 
              errors: ['Validation service unavailable'] 
            });
          }
          break;

        case 'GET_PERFORMANCE_STATS':
          try {
            const operationType = message.operationType;
            const stats = operationType ? 
              this.performanceMonitor.getStats(operationType) : 
              this.performanceMonitor.getAllStats();
            sendResponse({ success: true, data: stats });
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'POPUP_OPENED':
          try {
            console.log('[Background] Recebida mensagem POPUP_OPENED - iniciando limpeza do badge');
            // 🆕 Marcar relatórios AI como lidos quando popup é aberto
            await this.markAIReportsAsRead();
            console.log('[Background] Limpeza do badge concluída com sucesso');
            sendResponse({ success: true });
          } catch (error) {
            console.error('[Background] Erro na limpeza do badge:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'UPDATE_BADGE':
          try {
            console.log('[Background] Recebida mensagem UPDATE_BADGE - atualizando badge');
            await this.updateBadge();
            const count = await this.getUnreadAIReportsCount();
            console.log(`[Background] Badge atualizado com contador: ${count}`);
            sendResponse({ success: true, count: count });
          } catch (error) {
            console.error('[Background] Erro ao atualizar badge:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'START_RECORDING':
          try {
            // Obter a aba ativa atual em vez de depender do sender.tab
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const tabId = tabs[0]?.id;
            if (!tabId) {
              throw new Error('No active tab available');
            }
            console.log(`[Background] Iniciando gravação para aba ${tabId}`);
            await this.setRecordingState(tabId, {
              isRecording: true,
              startTime: Date.now(),
              maxDuration: message.maxDuration || 30000
            });
            sendResponse({ success: true, tabId: tabId });
          } catch (error) {
            console.error('[Background] Erro ao iniciar gravação:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'STOP_RECORDING':
          try {
            // Obter a aba ativa atual em vez de depender do sender.tab
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const tabId = tabs[0]?.id;
            if (!tabId) {
              throw new Error('No active tab available');
            }
            console.log(`[Background] Parando gravação para aba ${tabId}`);
            await this.clearRecordingState(tabId);
            sendResponse({ success: true, tabId: tabId });
          } catch (error) {
            console.error('[Background] Erro ao parar gravação:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'GET_RECORDING_STATE':
          try {
            // Obter a aba ativa atual em vez de depender do sender.tab
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const tabId = tabs[0]?.id;
            if (!tabId) {
              throw new Error('No active tab available');
            }
            console.log(`[Background] Obtendo estado de gravação para aba ${tabId}`);
            const state = await this.getRecordingState(tabId);
            sendResponse({ success: true, state: state, tabId: tabId });
          } catch (error) {
            console.error('[Background] Erro ao obter estado de gravação:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'INJECT_RECORDING_OVERLAY':
          try {
            const tabId = sender.tab?.id;
            if (!tabId) {
              throw new Error('No tab ID available');
            }
            console.log(`[Background] Injetando overlay de gravação na aba ${tabId}`);
            
            // Enviar mensagem para o content script injetar o overlay
            await chrome.tabs.sendMessage(tabId, {
              type: 'INJECT_OVERLAY',
              maxDuration: message.maxDuration || 30000
            });
            
            sendResponse({ success: true });
          } catch (error) {
            console.error('[Background] Erro ao injetar overlay:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'REMOVE_RECORDING_OVERLAY':
          try {
            const tabId = sender.tab?.id;
            if (!tabId) {
              throw new Error('No tab ID available');
            }
            console.log(`[Background] Removendo overlay de gravação da aba ${tabId}`);
            
            // Enviar mensagem para o content script remover o overlay
            await chrome.tabs.sendMessage(tabId, {
              type: 'REMOVE_OVERLAY'
            });
            
            sendResponse({ success: true });
          } catch (error) {
            console.error('[Background] Erro ao remover overlay:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'RECORDING_COMPLETED':
          try {
            const tabId = sender.tab?.id;
            if (!tabId) {
              throw new Error('No tab ID available');
            }
            console.log(`[Background] Gravação concluída na aba ${tabId}`);
            
            // Limpar estado de gravação
            await this.clearRecordingState(tabId);
            
            // Armazenar o vídeo gravado
            if (message.videoData) {
              const videoKey = `video_${tabId}_${Date.now()}`;
              await this.storageManager.store(videoKey, {
                data: message.videoData,
                timestamp: Date.now(),
                tabId: tabId,
                size: message.videoSize || 0
              });
              
              // Tentar abrir popup (pode falhar se não houver janela ativa)
              try {
                await chrome.action.openPopup();
              } catch (popupError) {
                console.log('[Background] Não foi possível abrir popup automaticamente:', popupError.message);
                // Mostrar notificação se não conseguir abrir popup
                chrome.notifications.create({
                  type: 'basic',
                  iconUrl: '/icon48.png',
                  title: 'BugSpotter - Gravação Concluída',
                  message: 'Vídeo capturado com sucesso! Clique no ícone da extensão para ver.'
                });
              }
              
              // Notificar popup sobre o vídeo (se estiver aberto)
              setTimeout(async () => {
                try {
                  await chrome.runtime.sendMessage({
                    type: 'VIDEO_ATTACHED',
                    videoKey: videoKey,
                    success: true
                  });
                } catch (e) {
                  console.log('[Background] Popup não está aberto para receber notificação');
                }
              }, 500);
            }
            
            sendResponse({ success: true });
          } catch (error) {
            console.error('[Background] Erro ao processar gravação concluída:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'RECORDING_FAILED':
          try {
            const tabId = sender.tab?.id;
            if (!tabId) {
              throw new Error('No tab ID available');
            }
            console.log(`[Background] Falha na gravação na aba ${tabId}:`, message.error);
            
            // Limpar estado de gravação
            await this.clearRecordingState(tabId);
            
            // Abrir popup com erro
            try {
              await chrome.action.openPopup();
            } catch (error) {
              console.log('[Background] Não foi possível abrir popup automaticamente:', error.message);
              // Criar notificação para informar sobre o erro
              chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: 'BugSpotter - Erro na Gravação',
                message: 'Ocorreu um erro durante a gravação. Clique no ícone da extensão para ver detalhes.'
              });
            }
            
            // Notificar popup sobre o erro
            setTimeout(async () => {
              try {
                await chrome.runtime.sendMessage({
                  type: 'VIDEO_ATTACHED',
                  success: false,
                  error: message.error || 'Erro desconhecido na gravação'
                });
              } catch (e) {
                console.log('[Background] Popup não está aberto para receber notificação de erro');
              }
            }, 500);
            
            sendResponse({ success: true });
          } catch (error) {
            console.error('[Background] Erro ao processar falha na gravação:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'GET_EXTENSION_SETTINGS':
          try {
            const settings = await this.getSettings();
            sendResponse({ success: true, settings: settings });
          } catch (error) {
            console.error('[Background] Erro ao obter configurações:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'openPopup':
          try {
            console.log('[Background] Abrindo popup via ação openPopup');
            try {
              await chrome.action.openPopup();
            } catch (error) {
              console.log('[Background] Não foi possível abrir popup automaticamente:', error.message);
              throw error; // Re-throw para manter o comportamento de erro na resposta
            }
            sendResponse({ success: true });
          } catch (error) {
            console.error('[Background] Erro ao abrir popup:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'stopRecording':
          try {
            console.log('[Background] Parando gravação via ação stopRecording');
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const tabId = tabs[0]?.id;
            if (tabId) {
              await this.clearRecordingState(tabId);
            }
            sendResponse({ success: true });
          } catch (error) {
            console.error('[Background] Erro ao parar gravação:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ error: error.message });
    }
  }

  async captureScreenshot(tabId) {
    const operationId = this.performanceMonitor.generateOperationId('screenshot');
    this.performanceMonitor.startOperation(operationId, 'screenshot', { tabId });
    
    try {
      // Verificar se a aba ainda existe antes de capturar screenshot
      const tabStillExists = await this.tabExists(tabId);
      if (!tabStillExists) {
        throw new Error(`Aba ${tabId} não existe mais, não é possível capturar screenshot`);
      }

      const result = await this.errorHandler.safeExecute(async () => {
        const screenshot = await chrome.tabs.captureVisibleTab(null, {
          format: 'png',
          quality: 90
        });
        return screenshot;
      }, 'Captura de screenshot', null);
      
      this.performanceMonitor.endOperation(operationId, true);
      return result;
    } catch (error) {
      // Tratamento específico para erro de tab inexistente
      if (error.message && error.message.includes('No tab with given id')) {
        // Tab foi fechada durante captura de screenshot - silenciado
        this.performanceMonitor.endOperation(operationId, true);
        return null;
      }
      
      this.performanceMonitor.endOperation(operationId, false, {
        message: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async getConsoleLogs(tabId) {
    const operationId = this.performanceMonitor.generateOperationId('logCapture');
    this.performanceMonitor.startOperation(operationId, 'logCapture', { tabId });
    
    try {
      // Verificar se a aba ainda existe antes de executar script
      const tabStillExists = await this.tabExists(tabId);
      if (!tabStillExists) {
        // Tab não existe mais - silenciado
        this.performanceMonitor.endOperation(operationId, true);
        return [];
      }

      const result = await this.errorHandler.safeExecute(async () => {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          function: () => {
            // Retorna logs capturados pelo content script
            return window.bugSpotterLogs || [];
          }
        });
        return results[0].result;
      }, 'Obter logs do console', []);
      
      this.performanceMonitor.endOperation(operationId, true);
      return result;
    } catch (error) {
      // Tratamento específico para erro de tab inexistente
      if (error.message && error.message.includes('No tab with given id')) {
        // Tab foi fechada durante execução do script - silenciado
        this.performanceMonitor.endOperation(operationId, true);
        return [];
      }
      
      this.performanceMonitor.endOperation(operationId, false, {
        message: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async saveBug(bugData) {
    try {
      const result = await chrome.storage.local.get(['bugs']);
      const bugs = result.bugs || [];
      
      bugData.id = Date.now().toString();
      bugData.timestamp = new Date().toISOString();
      
      bugs.push(bugData);
      await chrome.storage.local.set({ bugs });
      
      // Notifica o usuário
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon48.png'),
        title: 'BugSpotter',
        message: 'Bug salvo com sucesso!'
      });
      
    } catch (error) {
      throw new Error(`Failed to save bug: ${error.message}`);
    }
  }

  async sendToJira(bugData) {
    const operationId = this.performanceMonitor.generateOperationId('jiraSubmission');
    this.performanceMonitor.startOperation(operationId, 'jiraSubmission', { 
      title: bugData.title,
      priority: bugData.priority,
      hasAttachments: !!(bugData.attachments && bugData.attachments.length > 0)
    });
    
    try {
      const result = await this.errorHandler.executeWithRetry(async () => {
      const settings = await this.getSettings();
      
      if (!settings.jira || !settings.jira.enabled) {
        throw new Error('Jira integration not configured');
      }
  
      // Primeiro, criar o issue
      const jiraIssue = {
        fields: {
          project: { key: settings.jira.projectKey },
          summary: bugData.title,
          description: this.formatJiraDescription(bugData),
          issuetype: { id: settings.jira.issueTypeId || '10035' },
          priority: { name: await this.mapPriorityToJira(bugData.priority) }
        }
      };
  
      const response = await fetch(`${settings.jira.baseUrl}/rest/api/2/issue`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(`${settings.jira.email}:${settings.jira.apiToken}`)}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(jiraIssue)
      });
  
      if (!response.ok) {
        throw new Error(`Jira API error: ${response.statusText}`);
      }
  
      const result = await response.json();
      
      // Segundo, anexar os arquivos se existirem
      let attachmentResult = null;
      if (bugData.attachments && bugData.attachments.length > 0) {
        attachmentResult = await this.attachFilesToJiraIssue(result.key, bugData.attachments, settings);
      }

      // Notifica sucesso (usando caminho absoluto para o ícone)
      const notificationMessage = attachmentResult 
        ? `Bug sent to Jira: ${result.key}. Attachments: ${attachmentResult.successful.length}/${attachmentResult.totalProcessed} successful`
        : `Bug sent to Jira: ${result.key}`;
        
      try {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icon48.png'),
          title: 'BugSpotter',
          message: notificationMessage
        });
      } catch (notificationError) {
        console.warn('Erro ao criar notificação:', notificationError);
        // Não falhar o envio por causa da notificação
      }
  
        return result;
        
      }, 3, 1000);
      
      this.performanceMonitor.endOperation(operationId, true);
      return result;
    } catch (error) {
      this.performanceMonitor.endOperation(operationId, false, {
        message: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
  
  // Novo método para anexar arquivos
  async attachFilesToJiraIssue(issueKey, attachments, settings) {
    // Iniciando envio de anexos - silenciado
    
    const failedAttachments = [];
    const successfulAttachments = [];
    
    for (const attachment of attachments) {
      try {
        // Validação mais robusta
        if (!attachment || !attachment.data || typeof attachment.data !== 'string' || attachment.data.trim() === '') {
          console.warn(`Anexo ${attachment?.name || 'desconhecido'} não possui dados válidos ou não é uma string`);
          failedAttachments.push({ name: attachment?.name || 'desconhecido', error: 'Dados inválidos' });
          continue;
        }
        
        let blob;
        
        // Verificar se é base64 (screenshot/video) ou texto puro (DOM/console)
        if (attachment.data.startsWith('data:')) {
          // É base64 (screenshot ou vídeo)
          // Processando anexo base64 - silenciado
          try {
            const mimeMatch = attachment.data.match(/data:([^;]+);base64,/);
            const detectedMimeType = mimeMatch ? mimeMatch[1] : this.getMimeType(attachment.type);
            
            const base64Data = attachment.data.split(',')[1];
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            
            const byteArray = new Uint8Array(byteNumbers);
            blob = new Blob([byteArray], { type: detectedMimeType });
            
            // Para vídeos, garantir que o nome do arquivo tenha a extensão correta
            if (attachment.type === 'recording' || detectedMimeType.startsWith('video/')) {
              if (!attachment.name.endsWith('.webm')) {
                attachment.name = attachment.name.replace(/\.[^.]*$/, '') + '.webm';
              }
            }
          } catch (base64Error) {
            console.error(`Erro ao processar base64 do anexo ${attachment.name}:`, base64Error);
            failedAttachments.push({ name: attachment.name, error: 'Erro no processamento base64' });
            continue;
          }
        } else {
          // É texto puro (DOM/console)
          // Processando anexo de texto - silenciado
          blob = new Blob([attachment.data], { type: this.getMimeType(attachment.type) });
        }
        
        // Blob criado - silenciado
        
        // Criar FormData para multipart/form-data
        const formData = new FormData();
        formData.append('file', blob, attachment.name);
        
        // Enviando anexo - silenciado
        
        // Enviar anexo para Jira
        const attachResponse = await fetch(`${settings.jira.baseUrl}/rest/api/2/issue/${issueKey}/attachments`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${btoa(`${settings.jira.email}:${settings.jira.apiToken}`)}`,
            'X-Atlassian-Token': 'nocheck'
            // Não definir Content-Type - deixar o browser definir com boundary
          },
          body: formData
        });
        
        // Resposta do anexo - silenciado
        
        if (!attachResponse.ok) {
          const errorText = await attachResponse.text();
          console.error(`Erro ao anexar ${attachment.name}:`, attachResponse.statusText, errorText);
          failedAttachments.push({ name: attachment.name, error: `${attachResponse.status}: ${attachResponse.statusText}` });
        } else {
          const responseData = await attachResponse.json();
          // Anexo enviado com sucesso - silenciado
          successfulAttachments.push(attachment.name);
        }
      } catch (attachmentError) {
        console.error(`Erro inesperado ao processar anexo ${attachment?.name}:`, attachmentError);
        failedAttachments.push({ name: attachment?.name || 'desconhecido', error: attachmentError.message });
      }
    }
    
    // Finalizado envio de anexos - silenciado
    
    // Se houver falhas, logar mas não falhar completamente
    if (failedAttachments.length > 0) {
      console.warn('Alguns anexos falharam:', failedAttachments);
    }
    
    return {
      successful: successfulAttachments,
      failed: failedAttachments,
      totalProcessed: attachments.length
    };
  }
  
  // Método auxiliar para determinar MIME type
  getMimeType(attachmentType) {
    const mimeTypes = {
      'screenshot': 'image/png',
      'logs': 'application/json',  // Corrigido: logs são JSON
      'dom': 'text/html',
      'recording': 'video/webm',
      'video': 'video/webm'  // Adicionado suporte para tipo 'video'
    };
    return mimeTypes[attachmentType] || 'application/octet-stream';
  }

  formatJiraDescription(bugData) {
    return `
*Description:*
${bugData.description}

*Steps to Reproduce:*
${bugData.steps}

*Expected Behavior:*
${bugData.expectedBehavior || 'N/A'}

*Actual Behavior:*
${bugData.actualBehavior || 'N/A'}

*URL:* ${bugData.url}
*Component:* ${bugData.component || 'N/A'}
*Environment:* ${bugData.environment || 'N/A'}
*Priority:* ${bugData.priority || 'Medium'}
*Timestamp:* ${bugData.timestamp}
*Evidence:* ${bugData.attachments?.length || 0} file(s) attached to this ticket
  `;
  }

  // Remover este método obsoleto:
  // mapSeverityToPriority(severity) { ... }

  async mapPriorityToJira(priority) {
    try {
      const result = await chrome.storage.local.get(['settings']);
      const priorities = result.settings?.jira?.priorities || {
        'highest': 'Highest',
        'high': 'High',
        'medium': 'Medium', 
        'low': 'Low',
        'lowest': 'Lowest'
      };
      
      // Mapear tanto por chave quanto por valor
      const priorityValue = priorities[priority] || priority;
      
      // Se não encontrar, usar Medium como padrão
      return priorityValue || priorities['medium'] || 'Medium';
    } catch (error) {
      console.error('Erro ao carregar configurações de prioridade:', error);
      return 'Medium';
    }
  }

  async getSettings() {
    try {
      // Tentar usar StorageManager primeiro
      const settings = await this.storageManager.retrieve('jira_settings', 'chrome');
      if (settings) {
        return settings;
      }
      
      // Fallback para chrome.storage.local
      return new Promise((resolve) => {
        chrome.storage.local.get(['settings'], (result) => {
          resolve(result.settings || {});
        });
      });
    } catch (error) {
      this.errorHandler.handleError(error, 'getSettings');
      return {};
    }
  }

  /**
   * Armazena configurações do Jira de forma segura
   */
  async storeSecureJiraSettings(jiraConfig, masterPassword) {
    try {
      const validation = this.securityManager.validatePassword(masterPassword);
      if (!validation.isValid) {
        throw new Error('Senha mestre não atende aos requisitos de segurança');
      }

      const success = await this.securityManager.storeSecureData(
        'jira_credentials',
        JSON.stringify({
          email: jiraConfig.email,
          apiToken: jiraConfig.apiToken,
          baseUrl: jiraConfig.baseUrl,
          projectKey: jiraConfig.projectKey
        }),
        masterPassword
      );

      if (!success) {
        throw new Error('Falha ao armazenar credenciais do Jira');
      }

      // Armazenar configurações não sensíveis normalmente
      const publicSettings = {
        ...jiraConfig,
        email: undefined,
        apiToken: undefined
      };
      
      await chrome.storage.local.set({ jira_public_settings: publicSettings });
      return true;
    } catch (error) {
      console.error('Erro ao armazenar configurações seguras do Jira:', error);
      throw error;
    }
  }

  /**
   * Recupera configurações do Jira de forma segura
   */
  async getSecureJiraSettings(masterPassword) {
    try {
      const credentials = await this.securityManager.getSecureData('jira_credentials', masterPassword);
      if (!credentials) {
        return null;
      }

      const parsedCredentials = JSON.parse(credentials);
      const publicSettings = await chrome.storage.local.get(['jira_public_settings']);
      
      return {
        ...publicSettings.jira_public_settings,
        ...parsedCredentials
      };
    } catch (error) {
      console.error('Erro ao recuperar configurações seguras do Jira:', error);
      return null;
    }
  }

  /**
   * Remove configurações seguras do Jira
   */
  async removeSecureJiraSettings() {
    try {
      await this.securityManager.removeSecureData('jira_credentials');
      await chrome.storage.local.remove(['jira_public_settings']);
      return true;
    } catch (error) {
      console.error('Erro ao remover configurações seguras do Jira:', error);
      return false;
    }
  }

  async testJiraConnection(config) {
    try {
      // Validar URL
      const url = new URL(config.baseUrl);
      // Testing Jira connection - silenciado
      
      // Fazer a requisição HTTP
      const auth = btoa(`${config.email}:${config.apiToken}`);
      const response = await fetch(`${config.baseUrl}/rest/api/3/project/${config.projectKey}`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      // Jira response status - silenciado
      // Jira response headers - silenciado

      if (response.ok) {
        // Verificar se a resposta é JSON válido
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const responseText = await response.text();
          console.error('Expected JSON but received:', contentType, responseText.substring(0, 200));
          throw new Error(`Invalid response format. Expected JSON but received ${contentType || 'unknown'}. This might indicate a proxy, firewall, or incorrect Jira URL.`);
        }

        const project = await response.json();
        
        // 🆕 Buscar prioridades automaticamente após conexão bem-sucedida
        let priorities = null;
        try {
          priorities = await this.fetchJiraPriorities(config);
        } catch (priorityError) {
          console.warn('Não foi possível buscar prioridades:', priorityError.message);
        }
        
        return {
          success: true,
          message: `Connection successful! Project: ${project.name}`,
          project: project,
          priorities: priorities
        };
      } else if (response.status === 401) {
        throw new Error('Invalid credentials (email or API token)');
      } else if (response.status === 404) {
        throw new Error('Project not found. Check the project key.');
      } else {
        // Tentar ler a resposta para mais detalhes do erro
        let errorDetails = '';
        try {
          const responseText = await response.text();
          if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
            errorDetails = ' (Received HTML response - check if URL is correct and accessible)';
          } else {
            errorDetails = ` - ${responseText.substring(0, 100)}`;
          }
        } catch (e) {
          // Ignorar erro ao ler resposta
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}${errorDetails}`);
      }
    } catch (error) {
      if (error.message.includes('Invalid URL')) {
        throw new Error('Invalid Jira URL format');
      }
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Network error: Unable to connect to Jira. Check URL and network connectivity.');
      }
      throw error;
    }
  }

  /**
   * Busca as prioridades disponíveis no Jira
   */
  async fetchJiraPriorities(config) {
    try {
      const auth = btoa(`${config.email}:${config.apiToken}`);
      const response = await fetch(`${config.baseUrl}/rest/api/3/priority`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch priorities: ${response.statusText}`);
      }

      const priorities = await response.json();
      
      // Transformar em formato adequado para as configurações
      const priorityMap = {};
      priorities.forEach(priority => {
        // Usar o nome em lowercase como chave para compatibilidade
        const key = priority.name.toLowerCase().replace(/\s+/g, '');
        priorityMap[key] = priority.name;
      });

      return {
        raw: priorities,
        mapped: priorityMap
      };
    } catch (error) {
      console.error('Erro ao buscar prioridades do Jira:', error);
      throw error;
    }
  }

  // ✅ Função para definir a aba atual
  setCurrentTab(tabId) {
    this.currentTabId = tabId;
    console.log(`[Background] Aba atual definida: ${tabId}`);
  }

  // ✅ Função segura para manipular a aba atual
  async doSomethingWithCurrentTab(action = 'generic') {
    if (!this.currentTabId) {
      console.warn(`[Background] Nenhuma aba registrada para ação: ${action}`);
      return null;
    }

    try {
      const tab = await chrome.tabs.get(this.currentTabId);
      // Se chegou aqui, a aba existe
      console.log(`[Background] Executando '${action}' na aba:`, tab.id);
      return tab;
    } catch (err) {
      // Aba não existe ou erro na API
      if (err.message && err.message.includes('No tab with given id')) {
        console.log(`[Background] Aba atual ${this.currentTabId} não existe mais, limpando ID`);
        this.currentTabId = null;
      } else {
        console.error(`[Background] Erro ao acessar aba atual:`, err.message);
      }
      return null;
    }
  }

  onTabActivated(activeInfo) {
    // ✅ Atualizar aba atual quando usuário muda de aba
    this.setCurrentTab(activeInfo.tabId);
  }

  onFirstInstall() {
    // BugSpotter extension installed successfully - silenciado
    // Configurações iniciais da extensão
    this.setupContextMenus();
  }

  onTabCompleted(tabId, tab) {
    // ✅ Definir como aba atual se for a aba ativa
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0 && tabs[0].id === tabId) {
        this.setCurrentTab(tabId);
      }
    });
    
    // Auto-anexar debugger em todas as páginas web
    if (this.shouldAutoAttach(tab.url)) {
      // Auto-anexando debugger - silenciado
      // 🆕 REDUZIR delay para capturar logs mais cedo
      setTimeout(async () => {
        // ✅ VALIDAR se a tab ainda existe antes de anexar debugger
        const tabStillExists = await this.tabExists(tabId);
        if (tabStillExists) {
          this.attachDebugger(tabId);
        } else {
          // Tab foi fechada antes do auto-attach - silenciado
        }
      }, 500); // Reduzido de 1000ms para 500ms
    }
  }

  shouldAutoAttach(url) {
    // Anexar apenas em páginas HTTP/HTTPS (não extensões ou páginas especiais)
    return url && (url.startsWith('http://') || url.startsWith('https://'));
  }

  // Adicionar após setupDebuggerListeners() (linha ~56)
  setupContextMenus() {
    // Remover todos os menus de contexto existentes primeiro
    chrome.contextMenus.removeAll(() => {
      // Criar menu de contexto para captura rápida
      chrome.contextMenus.create({
        id: 'bugspotter-capture',
        title: 'BugSpotter - Capturar Bug',
        contexts: ['page', 'selection']
      });

      chrome.contextMenus.create({
        id: 'bugspotter-screenshot',
        title: 'BugSpotter - Capturar Screenshot',
        contexts: ['page']
      });
    });

    // Listener para cliques no menu de contexto
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      this.handleContextMenuClick(info, tab);
    });
  }

  handleContextMenuClick(info, tab) {
    switch (info.menuItemId) {
      case 'bugspotter-capture':
        this.captureScreenshot(tab.id);
        break;
      case 'bugspotter-screenshot':
        this.captureScreenshot(tab.id);
        break;
    }
  }

  // 🆕 NOVO: Método para capturar logs anteriores sob demanda
  async captureHistoricalLogs(tabId) {
    try {
      // Capturando logs históricos - silenciado
      
      // Usar apenas métodos existentes para evitar erros
      const allLogs = [];
      
      // Tentar obter logs do console existente
      try {
        const consoleLogs = await this.getConsoleLogs(tabId);
        if (consoleLogs && consoleLogs.length > 0) {
          allLogs.push(...consoleLogs);
        }
      } catch (e) {
        // Erro ao obter logs do console - silenciado
      }
      
      // Tentar obter logs do debugger se disponível
      try {
        const debuggerLogs = this.getDebuggerLogs(tabId);
        if (debuggerLogs && debuggerLogs.length > 0) {
          allLogs.push(...debuggerLogs);
        }
      } catch (e) {
        // Erro ao obter logs do debugger - silenciado
      }
      
      // Remover duplicatas e ordenar por timestamp
      const uniqueLogs = this.deduplicateLogs(allLogs);
      const sortedLogs = uniqueLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      // Total de logs históricos capturados - silenciado
      return sortedLogs;
      
    } catch (error) {
      console.error('[DEBUG] Erro ao capturar logs históricos:', error);
      return [];
    }
  }

  // 🆕 NOVO: Remover logs duplicados
  deduplicateLogs(logs) {
    const seen = new Set();
    return logs.filter(log => {
      const key = `${log.timestamp}-${log.text}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  // 🆕 Verificar se um log HTTP é duplicado
  isHttpLogDuplicate(tabId, url, status, timestamp) {
    if (!this.recentLogs.has(tabId)) {
      this.recentLogs.set(tabId, []);
    }
    
    const tabLogs = this.recentLogs.get(tabId);
    const currentTime = new Date(timestamp).getTime();
    
    // Limpar logs antigos (fora da janela de deduplicação)
    const validLogs = tabLogs.filter(log => {
      const logTime = new Date(log.timestamp).getTime();
      return (currentTime - logTime) <= this.logDeduplicationWindow;
    });
    this.recentLogs.set(tabId, validLogs);
    
    // Verificar se já existe um log similar
    const isDuplicate = validLogs.some(log => 
      log.url === url && 
      log.status === status &&
      Math.abs(currentTime - new Date(log.timestamp).getTime()) <= this.logDeduplicationWindow
    );
    
    if (!isDuplicate) {
      // Adicionar à lista de logs recentes
      validLogs.push({ url, status, timestamp });
      this.recentLogs.set(tabId, validLogs);
    }
    
    return isDuplicate;
  }
  
  /**
   * Processa erro HTTP com AI para gerar relatório automático
   * @param {Object} errorLog - Log do erro HTTP
   * @param {number} tabId - ID da aba onde ocorreu o erro
   */
  async processErrorWithAI(errorLog, tabId) {
    try {
      // 🆕 PRIMEIRA VALIDAÇÃO: Verificar se a aba ainda existe
      const tabStillExists = await this.tabExists(tabId);
      if (!tabStillExists) {
        console.log(`[Background] Aba ${tabId} não existe mais, cancelando processamento AI`);
        return;
      }
      
      // Verificar se AI está habilitada
      const settings = await this.getSettings();
      if (!settings.ai?.enabled) {
        return;
      }
      
      // 🆕 Filtrar apenas erros do domínio pp.daloop.app
      if (!errorLog.url || !errorLog.url.includes('pp.daloop.app')) {
        return;
      }
      
      // Verificar se o status do erro atende ao mínimo configurado
      const minStatus = settings.ai.minStatus || 400;
      if (errorLog.status < minStatus) {
        return;
      }
      
      // 🆕 Verificar se este erro já foi processado pela IA
      const errorHash = this.generateErrorHash(errorLog);
      if (this.isErrorAlreadyProcessed(errorHash)) {
        console.log(`[Background] Erro já processado pela IA, ignorando: ${errorLog.url} (${errorLog.status})`);
        return; // ❌ NÃO incrementar contador para erros duplicados
      }
      
      // Verificar se AIService está inicializado e pronto
      if (!this.aiService || !this.aiServiceReady || !this.aiService.isConfigured()) {
        console.warn('[Background] AIService não está configurado ou não está pronto');
        return;
      }
      
      // 🆕 Marcar erro como processado ANTES de enviar para IA
      this.markErrorAsProcessed(errorHash);
      
      // 🆕 Incrementar contador APENAS para novos erros (não deduplicated)
      await this.incrementUnreadAIReports();
      
      console.log(`[Background] Processando erro com IA: ${errorLog.url} (${errorLog.status})`);
      
      // 🆕 SEGUNDA VALIDAÇÃO: Verificar novamente se a aba ainda existe antes de coletar contexto
      const tabStillExistsBeforeContext = await this.tabExists(tabId);
      if (!tabStillExistsBeforeContext) {
        console.log(`[Background] Aba ${tabId} foi fechada durante processamento, cancelando coleta de contexto`);
        // Remover da lista de processados para permitir retry se a aba for reaberta
        this.processedAIErrors.delete(errorHash);
        return;
      }
      
      // Coletar contexto adicional
      const context = await this.collectErrorContext(errorLog, tabId);
      
      // Gerar relatório com AI
      const aiReport = await this.aiService.generateBugReport({
        error: errorLog,
        context: context,
        timestamp: new Date().toISOString()
      });
      
      if (aiReport) {
        // Armazenar relatório gerado pela AI
        await this.storeAIReport(aiReport, errorLog, tabId);
        
        // Enviar notificação se configurado
        if (settings.ai.autoNotify) {
          this.sendAINotification(aiReport, errorLog);
        }
        
        // Relatório AI gerado com sucesso - silenciado
      }
      
    } catch (error) {
      console.error('[Background] Erro ao processar com AI:', error);
      // 🆕 Se houve erro no processamento, remover da lista de processados para permitir retry
      const errorHash = this.generateErrorHash(errorLog);
      this.processedAIErrors.delete(errorHash);
    }
  }
  
  /**
   * 🆕 Gera hash único para um erro baseado em características principais
   * @param {Object} errorLog - Log do erro
   * @returns {string} Hash único do erro
   */
  generateErrorHash(errorLog) {
    // Criar hash baseado em URL, status, método e parte do corpo da resposta
    const hashData = {
      url: errorLog.url,
      status: errorLog.status,
      method: errorLog.method || 'GET',
      // Incluir apenas primeiros 200 caracteres do corpo da resposta para evitar hashes diferentes por timestamps
      responseSnippet: (errorLog.responseBody || errorLog.responseText || '').toString().substring(0, 200)
    };
    
    // Criar string para hash
    const hashString = JSON.stringify(hashData);
    
    // Gerar hash simples (não precisa ser criptográfico)
    let hash = 0;
    for (let i = 0; i < hashString.length; i++) {
      const char = hashString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Converter para 32bit integer
    }
    
    return hash.toString();
  }
  
  /**
   * 🆕 Verifica se um erro já foi processado pela IA
   * @param {string} errorHash - Hash do erro
   * @returns {boolean} True se já foi processado
   */
  isErrorAlreadyProcessed(errorHash) {
    const processedTime = this.processedAIErrors.get(errorHash);
    if (!processedTime) {
      return false;
    }
    
    // Verificar se ainda está dentro do TTL
    const now = Date.now();
    if (now - processedTime > this.aiErrorTTL) {
      // TTL expirado, remover da lista
      this.processedAIErrors.delete(errorHash);
      return false;
    }
    
    return true;
  }
  
  /**
   * 🆕 Marca um erro como processado pela IA
   * @param {string} errorHash - Hash do erro
   */
  markErrorAsProcessed(errorHash) {
    const timestamp = Date.now();
    this.processedAIErrors.set(errorHash, timestamp);
    console.log(`[AI] Erro marcado como processado: ${errorHash.substring(0, 8)}... (${this.processedAIErrors.size} total)`);
    
    // 🆕 Salvar no storage imediatamente
    this.saveProcessedErrorsToStorage();
    
    // Limpar entradas expiradas periodicamente
    this.cleanupExpiredAIErrors();
  }
  
  /**
   * 🆕 Remove erros expirados da lista de processados
   */
  cleanupExpiredAIErrors() {
    const now = Date.now();
    let removedCount = 0;
    
    for (const [hash, timestamp] of this.processedAIErrors.entries()) {
      if (now - timestamp > this.aiErrorTTL) {
        this.processedAIErrors.delete(hash);
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      console.log(`[AI] Removidos ${removedCount} hashes de erros expirados`);
      // 🆕 Salvar no storage após limpeza
      this.saveProcessedErrorsToStorage();
    }
  }

  /**
   * 🆕 Carregar erros processados do storage na inicialização
   */
  async loadProcessedErrorsFromStorage() {
    try {
      const result = await chrome.storage.local.get([this.processedErrorsStorageKey]);
      const storedErrors = result[this.processedErrorsStorageKey] || {};
      
      const now = Date.now();
      let loadedCount = 0;
      let expiredCount = 0;
      
      // Carregar apenas erros não expirados
      for (const [hash, timestamp] of Object.entries(storedErrors)) {
        if (now - timestamp <= this.aiErrorTTL) {
          this.processedAIErrors.set(hash, timestamp);
          loadedCount++;
        } else {
          expiredCount++;
        }
      }
      
      console.log(`[AI] Carregados ${loadedCount} hashes de erros do storage (${expiredCount} expirados removidos)`);
      
      // Se removemos erros expirados, salvar o estado limpo
      if (expiredCount > 0) {
        await this.saveProcessedErrorsToStorage();
      }
    } catch (error) {
      console.error('[AI] Erro ao carregar erros processados do storage:', error);
    }
  }

  /**
   * 🆕 Salvar erros processados no storage
   */
  async saveProcessedErrorsToStorage() {
    try {
      const errorsObject = Object.fromEntries(this.processedAIErrors);
      await chrome.storage.local.set({
        [this.processedErrorsStorageKey]: errorsObject
      });
      console.log(`[AI] Salvos ${this.processedAIErrors.size} hashes de erros no storage`);
    } catch (error) {
      console.error('[AI] Erro ao salvar erros processados no storage:', error);
    }
  }
  
  /**
   * Coleta contexto adicional para o erro
   * @param {Object} errorLog - Log do erro
   * @param {number} tabId - ID da aba
   * @returns {Object} Contexto do erro
   */
  async collectErrorContext(errorLog, tabId) {
    try {
      const context = {
        url: errorLog.url,
        method: errorLog.method,
        status: errorLog.status,
        statusText: errorLog.statusText,
        timestamp: errorLog.timestamp,
        responseBody: errorLog.responseBody || errorLog.decodedBody,
        responseText: errorLog.responseText,
        userAgent: navigator.userAgent
      };
      
      // Tentar obter informações da aba
      try {
        // 🆕 Usar função tabExists para validação prévia
        const tabStillExists = await this.tabExists(tabId);
        if (tabStillExists) {
          const tab = await chrome.tabs.get(tabId);
          context.pageUrl = tab.url;
          context.pageTitle = tab.title;
        } else {
          console.log(`[Background] Aba ${tabId} não existe mais durante coleta de contexto`);
          context.pageUrl = errorLog.url; // Usar URL do erro como fallback
          context.pageTitle = 'Tab closed';
        }
      } catch (e) {
        console.warn('[Background] Não foi possível obter informações da aba:', e);
        // Fallback para informações do erro
        context.pageUrl = errorLog.url;
        context.pageTitle = 'Unknown';
      }
      
      // Obter logs recentes relacionados
      const recentLogs = this.getRecentRelatedLogs(errorLog, tabId);
      if (recentLogs.length > 0) {
        context.recentLogs = recentLogs;
      }
      
      return context;
    } catch (error) {
      console.error('[Background] Erro ao coletar contexto:', error);
      return {};
    }
  }
  
  /**
   * Obtém logs recentes relacionados ao erro
   * @param {Object} errorLog - Log do erro principal
   * @param {number} tabId - ID da aba
   * @returns {Array} Logs relacionados
   */
  getRecentRelatedLogs(errorLog, tabId) {
    try {
      const persistentData = this.getPersistentLogs(tabId);
      if (!persistentData || !persistentData.logs) {
        return [];
      }
      
      const errorTime = new Date(errorLog.timestamp).getTime();
      const timeWindow = 30000; // 30 segundos antes do erro
      
      return persistentData.logs
        .filter(log => {
          const logTime = new Date(log.timestamp).getTime();
          return logTime >= (errorTime - timeWindow) && logTime <= errorTime;
        })
        .slice(-10); // Máximo 10 logs
    } catch (error) {
      console.error('[Background] Erro ao obter logs relacionados:', error);
      return [];
    }
  }
  
  /**
   * Armazena relatório gerado pela AI
   * @param {Object} aiReport - Relatório da AI
   * @param {Object} errorLog - Log do erro original
   * @param {number} tabId - ID da aba
   */
  async storeAIReport(aiReport, errorLog, tabId) {
    try {
      const reportData = {
        id: `ai-report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'ai-generated',
        title: aiReport.title,
        description: aiReport.description,
        severity: aiReport.severity,
        category: aiReport.category,
        suggestions: aiReport.suggestions,
        originalError: {
          url: errorLog.url,
          status: errorLog.status,
          statusText: errorLog.statusText,
          timestamp: errorLog.timestamp
        },
        tabId: tabId,
        createdAt: new Date().toISOString(),
        source: 'ai-auto-generated'
      };
      
      // Armazenar no storage
      const key = `ai-reports-${tabId}`;
      const existingReports = await chrome.storage.local.get(key);
      const reports = existingReports[key] || [];
      
      reports.push(reportData);
      
      // Manter apenas os últimos 50 relatórios por aba
      if (reports.length > 50) {
        reports.splice(0, reports.length - 50);
      }
      
      await chrome.storage.local.set({ [key]: reports });
      
      // Relatório AI armazenado - silenciado
    } catch (error) {
      console.error('[Background] Erro ao armazenar relatório AI:', error);
    }
  }
  
  /**
   * Envia notificação sobre relatório AI gerado
   * @param {Object} aiReport - Relatório da AI
   * @param {Object} errorLog - Log do erro original
   */
  async sendAINotification(aiReport, errorLog) {
    try {
      // Verificar configurações de notificação
      const settings = await this.getSettings();
      const notificationSettings = settings.notifications || {
        enabled: true,
        aiReports: true,
        criticalOnly: false,
        sound: true
      };

      if (!notificationSettings.enabled || !notificationSettings.aiReports) {
        return;
      }

      // Filtrar por severidade se configurado
      if (notificationSettings.criticalOnly && aiReport.severity !== 'critical') {
        return;
      }

      const notificationId = `ai-report-${Date.now()}`;
      const severity = (aiReport.severity || 'unknown').toUpperCase();
      
      // Definir ícone baseado na severidade
      const iconUrl = this.getNotificationIcon(aiReport.severity);
      
      chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: iconUrl,
        title: `BugSpotter AI - ${severity}`,
        message: `${aiReport.title}\n${errorLog.status} ${errorLog.statusText}`,
        contextMessage: `URL: ${new URL(errorLog.url).hostname}`,
        priority: aiReport.severity === 'critical' ? 2 : 1,
        requireInteraction: aiReport.severity === 'critical'
      });
      
      // Armazenar notificação para histórico
      await this.storeNotification({
        id: notificationId,
        type: 'ai-report',
        severity: aiReport.severity,
        title: aiReport.title,
        message: `${errorLog.status} ${errorLog.statusText}`,
        url: errorLog.url,
        timestamp: Date.now(),
        aiReportId: aiReport.id
      });
      
      // Auto-remover notificação (exceto críticas)
      if (aiReport.severity !== 'critical') {
        setTimeout(() => {
          chrome.notifications.clear(notificationId);
        }, 8000);
      }
      
    } catch (error) {
      console.error('[Background] Erro ao enviar notificação AI:', error);
    }
  }

  getNotificationIcon(severity) {
    // Usar chrome.runtime.getURL para obter o caminho correto do ícone
    switch (severity) {
      case 'critical':
        return chrome.runtime.getURL('icon48.png');
      case 'high':
        return chrome.runtime.getURL('icon48.png');
      case 'medium':
        return chrome.runtime.getURL('icon48.png');
      default:
        return chrome.runtime.getURL('icon48.png');
    }
  }

  async storeNotification(notification) {
    try {
      const result = await chrome.storage.local.get(['notifications']);
      const notifications = result.notifications || [];
      
      // Adicionar nova notificação
      notifications.unshift(notification);
      
      // Manter apenas as últimas 50 notificações
      if (notifications.length > 50) {
        notifications.splice(50);
      }
      
      await chrome.storage.local.set({ notifications });
    } catch (error) {
      console.error('[Background] Erro ao armazenar notificação:', error);
    }
  }

  async sendErrorNotification(errorLog, tabId) {
    try {
      const settings = await this.getSettings();
      const notificationSettings = settings.notifications || {
        enabled: true,
        httpErrors: true,
        errorThreshold: 400
      };

      if (!notificationSettings.enabled || !notificationSettings.httpErrors) {
        return;
      }

      // Verificar se o erro atende ao threshold
      if (errorLog.status < notificationSettings.errorThreshold) {
        return;
      }

      const notificationId = `error-${Date.now()}`;
      
      chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon48.png'),
        title: 'BugSpotter - Erro HTTP Detectado',
        message: `${errorLog.status} ${errorLog.statusText}`,
        contextMessage: `URL: ${new URL(errorLog.url).hostname}`,
        priority: errorLog.status >= 500 ? 2 : 1
      });
      
      // Armazenar notificação
      await this.storeNotification({
        id: notificationId,
        type: 'http-error',
        severity: errorLog.status >= 500 ? 'high' : 'medium',
        title: `Erro HTTP ${errorLog.status}`,
        message: errorLog.statusText,
        url: errorLog.url,
        timestamp: Date.now(),
        tabId: tabId
      });
      
      // Auto-remover após 6 segundos
      setTimeout(() => {
        chrome.notifications.clear(notificationId);
      }, 6000);
      
    } catch (error) {
      console.error('[Background] Erro ao enviar notificação de erro:', error);
    }
  }

  async getNotificationHistory() {
    try {
      const result = await chrome.storage.local.get(['notifications']);
      return result.notifications || [];
    } catch (error) {
      console.error('[Background] Erro ao obter histórico de notificações:', error);
      return [];
    }
  }

  async clearNotificationHistory() {
    try {
      await chrome.storage.local.remove(['notifications']);
    } catch (error) {
      console.error('[Background] Erro ao limpar histórico de notificações:', error);
    }
  }

  // 🆕 Sistema de Badge para Relatórios AI
  async updateBadge() {
    try {
      const count = await this.getUnreadAIReportsCount();
      const badgeText = count > 0 ? count.toString() : '';
      
      await chrome.action.setBadgeText({ text: badgeText });
      await chrome.action.setBadgeBackgroundColor({ color: '#FF4444' });
      
      console.log(`[Background] Badge atualizado: ${badgeText}`);
    } catch (error) {
      console.error('[Background] Erro ao atualizar badge:', error);
    }
  }

  async getUnreadAIReportsCount() {
    try {
      const result = await chrome.storage.local.get(['unreadAIReports']);
      return result.unreadAIReports || 0;
    } catch (error) {
      console.error('[Background] Erro ao obter contador de relatórios não lidos:', error);
      return 0;
    }
  }

  async incrementUnreadAIReports() {
    try {
      // Adicionar stack trace para debug
      const stack = new Error().stack;
      console.log('[Background] incrementUnreadAIReports chamado de:', stack.split('\n')[2]?.trim());
      
      const currentCount = await this.getUnreadAIReportsCount();
      const newCount = currentCount + 1;
      
      await chrome.storage.local.set({ unreadAIReports: newCount });
      await this.updateBadge();
      
      console.log(`[Background] Relatórios AI não lidos: ${currentCount} → ${newCount}`);
      
      // Verificar se o incremento foi persistido corretamente
      const verifyCount = await this.getUnreadAIReportsCount();
      if (verifyCount !== newCount) {
        console.warn(`[Background] PROBLEMA: Contador esperado ${newCount}, mas storage tem ${verifyCount}`);
      }
    } catch (error) {
      console.error('[Background] Erro ao incrementar relatórios não lidos:', error);
    }
  }

  async clearUnreadAIReports() {
    try {
      await chrome.storage.local.set({ unreadAIReports: 0 });
      await this.updateBadge();
      
      console.log('[Background] Badge limpo - relatórios marcados como lidos');
    } catch (error) {
      console.error('[Background] Erro ao limpar relatórios não lidos:', error);
    }
  }

  async markAIReportsAsRead() {
    // Limpeza imediata do badge (removido debounce para teste)
    console.log('[Background] markAIReportsAsRead chamado - limpando imediatamente');
    try {
      // Verificar contador atual antes de limpar
      const currentCount = await this.getUnreadAIReportsCount();
      console.log(`[Background] Contador atual antes da limpeza: ${currentCount}`);
      
      // Verificar badge atual
      const currentBadge = await chrome.action.getBadgeText({});
      console.log(`[Background] Badge atual antes da limpeza: '${currentBadge}'`);
      
      await this.clearUnreadAIReports();
      
      // Verificar se foi realmente limpo
      const newCount = await this.getUnreadAIReportsCount();
      const newBadge = await chrome.action.getBadgeText({});
      console.log(`[Background] Contador após limpeza: ${newCount}`);
      console.log(`[Background] Badge após limpeza: '${newBadge}'`);
      
      if (newCount === 0 && newBadge === '') {
        console.log('[Background] Badge limpo com sucesso');
      } else {
        console.warn(`[Background] Badge não foi limpo corretamente. Contador: ${newCount}, Badge: '${newBadge}'`);
        // Forçar limpeza adicional
        await chrome.action.setBadgeText({ text: '' });
        console.log('[Background] Limpeza forçada do badge executada');
      }
    } catch (error) {
      console.log('[Background] Erro ao limpar badge:', error);
    }
  }

  // 🆕 Métodos para gerenciar estado de gravação
  async setRecordingState(tabId, state) {
    try {
      console.log(`[Background] Definindo estado de gravação para tab ${tabId}:`, state);
      this.recordingStates.set(tabId, state);
      await this.saveRecordingStatesToStorage();
    } catch (error) {
      console.error('[Background] Erro ao definir estado de gravação:', error);
      throw error;
    }
  }

  async getRecordingState(tabId) {
    try {
      const state = this.recordingStates.get(tabId) || null;
      console.log(`[Background] Estado de gravação para tab ${tabId}:`, state);
      return state;
    } catch (error) {
      console.error('[Background] Erro ao obter estado de gravação:', error);
      return null;
    }
  }

  async clearRecordingState(tabId) {
    try {
      console.log(`[Background] Limpando estado de gravação para tab ${tabId}`);
      this.recordingStates.delete(tabId);
      await this.saveRecordingStatesToStorage();
    } catch (error) {
      console.error('[Background] Erro ao limpar estado de gravação:', error);
      throw error;
    }
  }

  async loadRecordingStatesFromStorage() {
    try {
      const result = await chrome.storage.local.get([this.recordingStorageKey]);
      const storedStates = result[this.recordingStorageKey] || {};
      
      // Converter objeto para Map
      this.recordingStates = new Map(Object.entries(storedStates));
      
      console.log(`[Background] Estados de gravação carregados:`, storedStates);
    } catch (error) {
      console.error('[Background] Erro ao carregar estados de gravação:', error);
      this.recordingStates = new Map();
    }
  }

  async saveRecordingStatesToStorage() {
    try {
      // Converter Map para objeto
      const statesToSave = Object.fromEntries(this.recordingStates);
      
      await chrome.storage.local.set({
        [this.recordingStorageKey]: statesToSave
      });
      
      console.log(`[Background] Estados de gravação salvos:`, statesToSave);
    } catch (error) {
      console.error('[Background] Erro ao salvar estados de gravação:', error);
    }
  }
}

// Implementar padrão singleton para evitar múltiplas instâncias
if (!globalThis.bugSpotterInstance) {
  console.log('[Background] Criando nova instância do BugSpotter');
  globalThis.bugSpotterInstance = new BugSpotterBackground();
} else {
  console.log('[Background] Instância do BugSpotter já existe, reutilizando');
}