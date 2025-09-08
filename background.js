class RateLimiter {
  constructor(maxRequests = 10, timeWindow = 60000) {
    this.requests = [];
    this.maxRequests = maxRequests;
    this.timeWindow = timeWindow;
  }
  
  canMakeRequest() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.timeWindow);
    return this.requests.length < this.maxRequests;
  }
}

class BugSpotterBackground {
  constructor() {
    // Adicionar gerenciamento de sessões debugger
    this.debuggerSessions = new Map();
    // Adicionar logs persistentes por aba
    this.persistentLogs = new Map();
    // Definir limite de logs por aba
    this.maxLogsPerTab = 200; // Reduzido de 1000 para 200
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.setupContextMenus();
    this.setupDebuggerListeners();
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
    
    // Limpar logs antigos periodicamente
    setInterval(() => {
      this.cleanupOldLogs();
    }, 5 * 60 * 1000); // A cada 5 minutos
  }
  
  cleanupTabData(tabId) {
    this.debuggerSessions.delete(tabId);
    this.persistentLogs.delete(tabId);
  }
  
  cleanupOldLogs() {
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
  }

  // Nova função para configurar listeners do debugger
  setupDebuggerListeners() {
    chrome.debugger.onEvent.addListener((source, method, params) => {
      this.handleDebuggerEvent(source, method, params);
    });

    chrome.debugger.onDetach.addListener((source, reason) => {
      console.log(`Debugger detached from tab ${source.tabId}: ${reason}`);
      this.debuggerSessions.delete(source.tabId);
    });
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
        
        console.log(`[DEBUG] Console.messageAdded capturado:`, consoleEntry);
        
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
        
        console.log(`[DEBUG] Runtime.consoleAPICalled capturado:`, apiEntry);
        
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
        
        console.log(`[DEBUG] Runtime.exceptionThrown capturado:`, errorEntry);
        
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
        
        console.log(`[DEBUG] Network.requestWillBeSent capturado:`, requestEntry);
        
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
        
        console.log(`[DEBUG] Network.responseReceived capturado:`, responseEntry);
        
        // 🆕 NOVO: Capturar corpo da resposta para erros HTTP
        if (params.response.status >= 400) {
          try {
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
              
              console.log(`[DEBUG] HTTP Error com corpo capturado:`, detailedErrorLog);
              
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
              
            }).catch((error) => {
              console.warn(`[DEBUG] Não foi possível obter corpo da resposta para ${params.requestId}:`, error);
              
              // Fallback: adicionar erro sem corpo da resposta
              const basicError = {
                type: 'http-error',
                level: 'error',
                text: `[HTTP ERROR] ${params.response.status} ${params.response.statusText} - ${params.response.url}`,
                timestamp: responseEntry.timestamp,
                url: params.response.url,
                status: params.response.status,
                statusText: params.response.statusText,
                note: 'Response body could not be retrieved'
              };
              
              const session = this.debuggerSessions.get(tabId);
              const persistentData = this.getPersistentLogs(tabId);
              
              if (session) {
                this.addToBuffer(session.logs, basicError);
              }
              if (persistentData) {
                this.addToBuffer(persistentData.logs, basicError);
                this.addToBuffer(persistentData.errors, basicError);
              }
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
        
        console.log(`[DEBUG] Network.loadingFailed capturado:`, failedEntry);
        
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
        
        console.log(`[DEBUG] Network.loadingFinished capturado:`, finishedEntry);
        
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
        console.log(`[DEBUG] Evento debugger não tratado: ${method}`, params);
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
    try {
      // Verificar se já está anexado
      if (this.debuggerSessions.has(tabId)) {
        console.log(`Debugger já anexado para tab ${tabId}`);
        return { success: true, message: 'Debugger already attached' };
      }
  
      console.log(`Tentando anexar debugger para tab ${tabId}`);
      await chrome.debugger.attach({tabId}, "1.3");
      
      // Habilitar domínios necessários
      await chrome.debugger.sendCommand({tabId}, "Runtime.enable");
      await chrome.debugger.sendCommand({tabId}, "Console.enable");
      await chrome.debugger.sendCommand({tabId}, "Network.enable");
      
      // Configurações avançadas para capturar todos os tipos de logs
      await chrome.debugger.sendCommand({tabId}, "Runtime.setAsyncCallStackDepth", { maxDepth: 32 });
      // ❌ REMOVER esta linha que causa o erro:
      // await chrome.debugger.sendCommand({tabId}, "Console.setMonitoringXHREnabled", { enabled: true });
      
      // 🆕 CAPTURAR LOGS EXISTENTES ANTES DE LIMPAR
      let existingLogs = [];
      try {
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
          console.log(`[DEBUG] Logs existentes capturados do content script: ${existingLogs.length}`);
        }
      } catch (e) {
        console.log('Aviso: Não foi possível obter logs do content script:', e.message);
      }
      
      // Tentar capturar logs do console do navegador
      try {
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
            console.log(`[DEBUG] Logs adicionais do browser: ${formattedBrowserLogs.length}`);
          }
        }
      } catch (e) {
        console.log('Aviso: Não foi possível obter logs do browser console:', e.message);
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
  
      console.log(`✅ Debugger anexado com sucesso para tab ${tabId}. Logs existentes: ${existingLogs.length}`);
      return { success: true, message: 'Debugger attached successfully', existingLogs: existingLogs.length };
      
    } catch (error) {
      console.error(`❌ Erro ao anexar debugger para tab ${tabId}:`, error);
      return { success: false, error: error.message };
    }
  }

  // Desanexar debugger de uma aba
  async detachDebugger(tabId) {
    try {
      if (this.debuggerSessions.has(tabId)) {
        await chrome.debugger.detach({tabId});
        this.debuggerSessions.delete(tabId);
        console.log(`Debugger detached from tab ${tabId}`);
      }
    } catch (error) {
      console.error('Erro ao desanexar debugger:', error);
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
      switch (message.action) {
        case 'CAPTURE_SCREENSHOT':
          const screenshot = await this.captureScreenshot(sender.tab.id);
          sendResponse({ success: true, data: screenshot });
          break;

        case 'GET_CONSOLE_LOGS':
          const logs = await this.getConsoleLogs(sender.tab.id);
          sendResponse({ success: true, data: logs });
          break;

        case 'ATTACH_DEBUGGER':
          try {
            const tabId = message.tabId || sender.tab?.id;
            if (!tabId) {
              throw new Error('No tab ID provided');
            }
            await this.attachDebugger(tabId);
            sendResponse({ success: true });
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'DETACH_DEBUGGER':
          try {
            const tabId = message.tabId || sender.tab?.id;
            if (!tabId) {
              throw new Error('No tab ID provided');
            }
            await this.detachDebugger(tabId);
            sendResponse({ success: true });
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'GET_DEBUGGER_LOGS':
          try {
            const tabId = message.tabId || sender.tab?.id;
            if (!tabId) {
              throw new Error('No tab ID provided');
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
              domainFilter: domainFilter
            };
            
            sendResponse({ success: true, data: combinedLogs });
          } catch (error) {
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

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ error: error.message });
    }
  }

  async captureScreenshot(tabId) {
    try {
      const screenshot = await chrome.tabs.captureVisibleTab(null, {
        format: 'png',
        quality: 90
      });
      return screenshot;
    } catch (error) {
      throw new Error(`Failed to capture screenshot: ${error.message}`);
    }
  }

  async getConsoleLogs(tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        function: () => {
          // Retorna logs capturados pelo content script
          return window.bugSpotterLogs || [];
        }
      });
      return results[0].result;
    } catch (error) {
      throw new Error(`Failed to get console logs: ${error.message}`);
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
        iconUrl: 'icons/icon48.png',
        title: 'BugSpotter',
        message: 'Bug salvo com sucesso!'
      });
      
    } catch (error) {
      throw new Error(`Failed to save bug: ${error.message}`);
    }
  }

  async sendToJira(bugData) {
    try {
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
          priority: { name: this.mapPriorityToJira(bugData.priority) }
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
      if (bugData.attachments && bugData.attachments.length > 0) {
        await this.attachFilesToJiraIssue(result.key, bugData.attachments, settings);
      }
  
      // Notifica sucesso
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon48.png',
        title: 'BugSpotter',
        message: `Bug sent to Jira: ${result.key} with ${bugData.attachments?.length || 0} attachment(s)`
      });
  
      return result;
      
    } catch (error) {
      throw new Error(`Failed to send to Jira: ${error.message}`);
    }
  }
  
  // Novo método para anexar arquivos
  async attachFilesToJiraIssue(issueKey, attachments, settings) {
    console.log(`Iniciando envio de ${attachments.length} anexo(s) para issue ${issueKey}`);
    
    // No método attachFilesToJiraIssue, linha ~240
    for (const attachment of attachments) {
    // Validação mais robusta
    if (!attachment || !attachment.data || typeof attachment.data !== 'string' || attachment.data.trim() === '') {
    console.warn(`Anexo ${attachment?.name || 'desconhecido'} não possui dados válidos ou não é uma string`);
    continue; // Pular este anexo em vez de falhar
    }
    
    let blob;
    
    // Verificar se é base64 (screenshot) ou texto puro (DOM/console)
    if (attachment.data.startsWith('data:')) {
      // É base64 (screenshot)
      console.log('Processando anexo base64 (screenshot)');
      const base64Data = attachment.data.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      
      const byteArray = new Uint8Array(byteNumbers);
      blob = new Blob([byteArray], { type: this.getMimeType(attachment.type) });
    } else {
      // É texto puro (DOM/console)
      console.log('Processando anexo de texto (DOM/console)');
      blob = new Blob([attachment.data], { type: this.getMimeType(attachment.type) });
    }
    
    console.log(`Blob criado: ${blob.size} bytes, tipo: ${blob.type}`);
    
    // Criar FormData para multipart/form-data
    const formData = new FormData();
    formData.append('file', blob, attachment.name);
    
    console.log(`Enviando anexo para: ${settings.jira.baseUrl}/rest/api/2/issue/${issueKey}/attachments`);
    
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
    
    console.log(`Resposta do anexo ${attachment.name}: ${attachResponse.status} ${attachResponse.statusText}`);
    
    if (!attachResponse.ok) {
      const errorText = await attachResponse.text();
      console.error(`Erro ao anexar ${attachment.name}:`, attachResponse.statusText, errorText);
    } else {
      const responseData = await attachResponse.json();
      console.log(`Anexo ${attachment.name} enviado com sucesso:`, responseData);
    }
    }
    
    console.log('Finalizado envio de anexos');
  }
  
  // Método auxiliar para determinar MIME type
  getMimeType(attachmentType) {
    const mimeTypes = {
      'screenshot': 'image/png',
      'logs': 'application/json',  // Corrigido: logs são JSON
      'dom': 'text/html',
      'recording': 'video/webm'
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

  mapPriorityToJira(priority) {
    const mapping = {
      'Highest': 'Highest',
      'High': 'High',
      'Medium': 'Medium', 
      'Low': 'Low',
      'Lowest': 'Lowest'
    };
    return mapping[priority] || 'Medium';
  }

  async getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['settings'], (result) => {
        resolve(result.settings || {});
      });
    });
  }

  async testJiraConnection(config) {
    try {
      // Validar URL
      new URL(config.baseUrl);
      
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

      if (response.ok) {
        const project = await response.json();
        return {
          success: true,
          message: `Connection successful! Project: ${project.name}`,
          project: project
        };
      } else if (response.status === 401) {
        throw new Error('Invalid credentials (email or API token)');
      } else if (response.status === 404) {
        throw new Error('Project not found. Check the project key.');
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      if (error.message.includes('Invalid URL')) {
        throw new Error('Invalid Jira URL');
      }
      throw error;
    }
  }

  onTabActivated(activeInfo) {
    // Implementar lógica quando aba é ativada
  }

  onFirstInstall() {
    console.log('BugSpotter extension installed successfully!');
    // Configurações iniciais da extensão
    this.setupContextMenus();
  }

  onTabCompleted(tabId, tab) {
    // Auto-anexar debugger em todas as páginas web
    if (this.shouldAutoAttach(tab.url)) {
      console.log(`Auto-anexando debugger para: ${tab.url}`);
      // 🆕 REDUZIR delay para capturar logs mais cedo
      setTimeout(() => {
        this.attachDebugger(tabId);
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
      console.log(`[DEBUG] Capturando logs históricos para tab ${tabId}`);
      
      // Tentar múltiplas fontes de logs
      const sources = [
        // Content script
        this.getLogsFromContentScript(tabId),
        // localStorage da página
        this.getLogsFromPageStorage(tabId),
        // Console do navegador
        this.getLogsFromBrowserConsole(tabId)
      ];
      
      const results = await Promise.allSettled(sources);
      const allLogs = [];
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          allLogs.push(...result.value);
          console.log(`[DEBUG] Fonte ${index} retornou ${result.value.length} logs`);
        }
      });
      
      // Remover duplicatas e ordenar por timestamp
      const uniqueLogs = this.deduplicateLogs(allLogs);
      const sortedLogs = uniqueLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      console.log(`[DEBUG] Total de logs históricos capturados: ${sortedLogs.length}`);
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
      const key = `${log.timestamp}-${log.level}-${log.text}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}

// Inicializa o background script
new BugSpotterBackground();