// Verificar se já foi inicializado para evitar duplicação
if (typeof window.bugSpotterContentInitialized === 'undefined') {
  window.bugSpotterContentInitialized = true;
  
  // Removido log de debug para reduzir ruído

  // Carregar módulo de storage se disponível
  if (typeof StorageManager !== 'undefined') {
    window.storageManager = new StorageManager();
    // StorageManager inicializado silenciosamente
  } else {
    // StorageManager não disponível - mantendo silencioso
  }

  class BugSpotterContent {
    constructor() {
      // Inicializando BugSpotterContent silenciosamente
      this.consoleLogs = [];
      this.maxLogs = 500; // Aumentar para 500 logs
      this.saveInterval = null;
      this.errorHandler = null;
      this.rejectionHandler = null;
      this.beforeUnloadHandler = null;
      this.logsRecovered = false; // Flag para evitar recuperação múltipla
      this.lastSaveTime = 0; // Controle de salvamento
      this.init();
    }

    init() {
      this.interceptConsoleLogs();
      this.setupErrorHandling();
      this.injectPageScript();
      this.startContinuousCapture(); // Nova função
      this.setupInteractionCapture(); // Captura de cliques/inputs do utilizador
    }

    interceptConsoleLogs() {
      // Interceptar apenas console.warn e console.error (não console.log)
      const originalMethods = {};
      const consoleMethods = ['error', 'warn'];
      
      consoleMethods.forEach(method => {
        originalMethods[method] = console[method];
        console[method] = (...args) => {
          this.addLog(method, args);
          originalMethods[method].apply(console, args);
        };
      });
    }

    setupErrorHandling() {
      // Configurar handlers de erro que serão definidos em startContinuousCapture
      this.visibilityChangeHandler = () => {
        if (document.hidden) {
          this.cleanup();
        }
      };
      document.addEventListener('visibilitychange', this.visibilityChangeHandler);
    }

    injectPageScript() {
      // Interceptar fetch API - apenas erros HTTP (400+) e suas respostas
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        try {
          const response = await originalFetch.apply(window, args);
          const url = args[0];
          
          // Extrair método HTTP dos argumentos do fetch
          let method = 'GET'; // Padrão
          if (args[1] && args[1].method) {
            method = args[1].method.toUpperCase();
          }
          
          // Log apenas erros HTTP (status 400+) e não requisições internas da extensão
          if (!url.includes('chrome-extension://') && response.status >= 400) {
            // Capturar corpo da resposta para erros HTTP
            let responseBody = null;
            let responseText = null;
            try {
              // Clonar a resposta para poder ler o corpo sem afetar o uso original
              const responseClone = response.clone();
              responseText = await responseClone.text();
              
              // Tentar parsear como JSON se possível
              try {
                responseBody = JSON.parse(responseText);
              } catch (e) {
                // Se não for JSON válido, manter como texto
                responseBody = responseText;
              }
            } catch (e) {
              console.warn('Não foi possível capturar corpo da resposta:', e);
            }
            
            const errorMessage = responseBody 
              ? `[HTTP ERROR] ${response.status} ${response.statusText} - ${method} ${url} | Response: ${JSON.stringify(responseBody)}`
              : `[HTTP ERROR] ${response.status} ${response.statusText} - ${method} ${url}`;
            
            this.addLog('error', [errorMessage]);
            
            // Enviar para background script
            chrome.runtime.sendMessage({
              type: 'HTTP_ERROR',
              data: {
                status: response.status,
                statusText: response.statusText,
                url: url,
                method: method,
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                referrer: document.referrer,
                responseBody: responseBody,
                responseText: responseText
              }
            });
          }
          return response;
        } catch (error) {
          const url = args[0];
          let method = 'GET'; // Padrão
          if (args[1] && args[1].method) {
            method = args[1].method.toUpperCase();
          }
          
          this.addLog('error', [`[NETWORK ERROR] - ${method} ${url}: ${error.message}`]);
          chrome.runtime.sendMessage({
            type: 'NETWORK_ERROR',
            data: {
              error: error.message,
              url: url,
              method: method,
              timestamp: new Date().toISOString(),
              userAgent: navigator.userAgent,
              referrer: document.referrer
            }
          });
          throw error;
        }
      };

      // Interceptar XMLHttpRequest
      const originalXHROpen = XMLHttpRequest.prototype.open;
      const originalXHRSend = XMLHttpRequest.prototype.send;
      
      XMLHttpRequest.prototype.open = function(method, url, ...args) {
        this._bugSpotterUrl = url;
        this._bugSpotterMethod = method;
        return originalXHROpen.apply(this, [method, url, ...args]);
      };
      
      XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('loadend', () => {
          // Log apenas erros HTTP (status 400+) e não requisições internas da extensão
          if (!this._bugSpotterUrl.includes('chrome-extension://') && this.status >= 400) {
            // Capturar corpo da resposta para erros HTTP
            let responseBody = null;
            let responseText = this.responseText;
            
            try {
              // Tentar parsear como JSON se possível
              if (responseText) {
                try {
                  responseBody = JSON.parse(responseText);
                } catch (e) {
                  // Se não for JSON válido, manter como texto
                  responseBody = responseText;
                }
              }
            } catch (e) {
              console.warn('Não foi possível capturar corpo da resposta XMLHttpRequest:', e);
            }
            
            const errorMessage = responseBody 
              ? `[HTTP ERROR] ${this.status} ${this.statusText} - ${this._bugSpotterMethod} ${this._bugSpotterUrl} | Response: ${JSON.stringify(responseBody)}`
              : `[HTTP ERROR] ${this.status} ${this.statusText} - ${this._bugSpotterMethod} ${this._bugSpotterUrl}`;
            
            window.bugSpotterContent.addLog('error', [errorMessage]);
            
            chrome.runtime.sendMessage({
              type: 'HTTP_ERROR',
              data: {
                status: this.status,
                statusText: this.statusText,
                method: this._bugSpotterMethod,
                url: this._bugSpotterUrl,
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                referrer: document.referrer,
                responseBody: responseBody,
                responseText: responseText
              }
            });
          }
        });
        
        this.addEventListener('error', () => {
          window.bugSpotterContent.addLog('error', [`[NETWORK ERROR] - ${this._bugSpotterMethod} ${this._bugSpotterUrl}`]);
          chrome.runtime.sendMessage({
            type: 'NETWORK_ERROR',
            data: {
              error: 'Network request failed',
              method: this._bugSpotterMethod,
              url: this._bugSpotterUrl,
              timestamp: new Date().toISOString(),
              userAgent: navigator.userAgent,
              referrer: document.referrer
            }
          });
        });
        
        return originalXHRSend.apply(this, args);
      };

      // Definir window.bugSpotterLogs para compatibilidade
      window.bugSpotterLogs = this.consoleLogs;
    }
  
    // 🆕 NOVA: Captura contínua desde o carregamento
    startContinuousCapture() {
      // Capturar logs imediatamente ao carregar
      this.captureExistingLogs();
      
      // Interceptar erros globais com referência armazenada
      this.errorHandler = (event) => {
        this.addLog('error', [`${event.message} at ${event.filename}:${event.lineno}:${event.colno}`]);
      };
      window.addEventListener('error', this.errorHandler);
      
      // Interceptar promises rejeitadas com referência armazenada
      this.rejectionHandler = (event) => {
        this.addLog('error', [`Unhandled Promise Rejection: ${event.reason}`]);
        // Prevenir que o erro apareça no console
        event.preventDefault();
      };
      window.addEventListener('unhandledrejection', this.rejectionHandler);
      
      // Salvar logs no localStorage para persistência
      this.saveLogsToStorage();
      this.saveInterval = setInterval(() => this.saveLogsToStorage(), 5000);
      
      // Adicionar cleanup com referência armazenada
      this.beforeUnloadHandler = () => {
        this.cleanup();
      };
      window.addEventListener('beforeunload', this.beforeUnloadHandler);
      
      // Cleanup quando a página é escondida (mobile/tab switching)
      this.visibilityChangeHandler = () => {
        if (document.hidden) {
          this.cleanup();
        }
      };
      document.addEventListener('visibilitychange', this.visibilityChangeHandler);
    }

    // 🆕 Captura de interações do utilizador (cliques, inputs, submits)
    setupInteractionCapture() {
      const captureElementPath = (el) => {
        try {
          const path = [];
          let node = el;
          while (node && node.nodeType === Node.ELEMENT_NODE && path.length < 10) {
            let selector = node.tagName.toLowerCase();
            if (node.id) selector += `#${node.id}`;
            if (node.className && typeof node.className === 'string') {
              const cls = node.className.trim().split(/\s+/).slice(0, 3).join('.');
              if (cls) selector += `.${cls}`;
            }
            path.unshift(selector);
            node = node.parentElement;
          }
          return path.join(' > ');
        } catch (_) {
          return 'unknown-path';
        }
      };

      const sanitizeValue = (value, type) => {
        try {
          if (!value) return '';
          if ((type || '').toLowerCase() === 'password') return '***';
          const str = String(value);
          return str.length > 120 ? str.slice(0, 120) + '…' : str;
        } catch (_) {
          return '';
        }
      };

      const recordInteraction = (kind, details) => {
        const item = {
          kind,
          ts: Date.now(),
          pageUrl: location.href,
          ...details
        };
        // Buffer local para robustez
        if (Array.isArray(this.interactionBuffer)) {
          this.interactionBuffer.push(item);
          if (this.interactionBuffer.length > (this.maxInteractions || 200)) {
            this.interactionBuffer.shift();
          }
        }
        // Enviar para background
        try {
          chrome.runtime.sendMessage({ action: 'LOG_USER_INTERACTION', data: item });
        } catch (_) {}
      };

      // Clique
      document.addEventListener('click', (e) => {
        const target = e.target;
        const rect = target && target.getBoundingClientRect ? target.getBoundingClientRect() : null;
        const details = {
          tag: target?.tagName?.toLowerCase() || 'unknown',
          id: target?.id || '',
          classes: target?.className || '',
          text: sanitizeValue(target?.innerText || target?.value || '', target?.type),
          path: captureElementPath(target),
          x: e.clientX,
          y: e.clientY,
          bbox: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null
        };
        recordInteraction('click', details);
      }, true);

      // Inputs (input/change)
      const inputHandler = (e) => {
        const el = e.target;
        const type = (el?.type || el?.tagName || '').toLowerCase();
        const details = {
          tag: el?.tagName?.toLowerCase() || 'unknown',
          id: el?.id || '',
          classes: el?.className || '',
          name: el?.name || '',
          placeholder: el?.placeholder || '',
          path: captureElementPath(el),
          value: sanitizeValue(el?.value || '', type),
          inputType: type
        };
        recordInteraction(e.type === 'change' ? 'change' : 'input', details);
      };
      document.addEventListener('input', inputHandler, true);
      document.addEventListener('change', inputHandler, true);

      // Submit de formulários
      document.addEventListener('submit', (e) => {
        const form = e.target;
        const details = {
          tag: 'form',
          id: form?.id || '',
          classes: form?.className || '',
          path: captureElementPath(form)
        };
        recordInteraction('submit', details);
      }, true);
    }
    
    // Método de cleanup centralizado
    cleanup() {
      // Evitar cleanup múltiplo
      if (this._cleanupInProgress) {
        return;
      }
      this._cleanupInProgress = true;

      if (this.saveInterval) {
        clearInterval(this.saveInterval);
        this.saveInterval = null;
      }
      
      if (this.errorHandler) {
        window.removeEventListener('error', this.errorHandler);
        this.errorHandler = null;
      }
      
      if (this.rejectionHandler) {
        window.removeEventListener('unhandledrejection', this.rejectionHandler);
        this.rejectionHandler = null;
      }
      
      if (this.beforeUnloadHandler) {
        window.removeEventListener('beforeunload', this.beforeUnloadHandler);
        this.beforeUnloadHandler = null;
      }
      
      if (this.visibilityChangeHandler) {
        document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
        this.visibilityChangeHandler = null;
      }
      
      // Salvar logs finais antes do cleanup apenas se o contexto ainda for válido
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        this.saveLogsToStorage().catch(error => {
          console.warn('Erro ao salvar logs durante cleanup:', error.message);
        });
        // Persistir interações recentes para referência
        try {
          const key = 'bugSpotter_interactions_snapshot';
          const payload = JSON.stringify({ ts: Date.now(), url: location.href, items: this.interactionBuffer || [] });
          localStorage.setItem(key, payload);
        } catch (_) {}
      }
    }
    
    // 🆕 NOVA: Capturar logs que já existem (apenas uma vez por sessão)
    async captureExistingLogs() {
      // Evitar recuperação múltipla na mesma sessão
      if (this.logsRecovered) {
        return;
      }
      
      try {
        // Tentar recuperar logs salvos anteriormente
        let savedLogsData;
        
        if (window.storageManager) {
          savedLogsData = await window.storageManager.retrieve('bugSpotter_logs', 'local');
        } else {
          const savedLogs = localStorage.getItem('bugSpotter_logs');
          savedLogsData = savedLogs ? JSON.parse(savedLogs) : null;
        }
        
        // Verificar se os dados recuperados são válidos
        if (savedLogsData && typeof savedLogsData === 'object') {
          if (savedLogsData.logs && Array.isArray(savedLogsData.logs)) {
            // Filtrar logs antigos (mais de 1 hora) e logs sobre corrupção
            const oneHourAgo = Date.now() - (60 * 60 * 1000);
            const recentLogs = savedLogsData.logs.filter(log => {
              const logTime = new Date(log.timestamp).getTime();
              const isRecent = logTime > oneHourAgo;
              
              // Filtrar logs sobre corrupção para quebrar loops
              const message = log.message || '';
              const isCorruptionLog = message.includes('mobime-pp') || 
                                    message.includes('Dados corrompidos') ||
                                    message.includes('Erro ao parsear JSON') ||
                                    message.includes('Detectado padrão de corrupção') ||
                                    message.includes('Removido dado corrompido');
              
              return isRecent && !isCorruptionLog;
            });
            
            if (recentLogs.length > 0) {
              this.consoleLogs = [...recentLogs];
              // Logs recuperados silenciosamente
            } else {
              // Iniciando com logs vazios
            }
          } else {
            // Dados inválidos detectados, limpando storage
            await this.clearCorruptedData();
          }
        } else if (savedLogsData && typeof savedLogsData === 'string') {
          // Dados podem estar corrompidos, tentar limpar
          // Dados corrompidos detectados, limpando storage
          await this.clearCorruptedData();
        }
        
        this.logsRecovered = true;
      } catch (e) {
        // Erro ao recuperar logs anteriores - silenciado
        // Em caso de erro, limpar dados corrompidos
        await this.clearCorruptedData();
        this.logsRecovered = true;
      }
    }
    
    // Função para limpar dados corrompidos
    async clearCorruptedData() {
      try {
        if (window.storageManager) {
          await window.storageManager.remove('bugSpotter_logs', 'local');
          // Dados corrompidos removidos do storage
        } else {
          localStorage.removeItem('bugSpotter_logs');
          // Dados corrompidos removidos do localStorage
        }
      } catch (e) {
        // Erro ao limpar dados corrompidos - silenciado
      }
    }
    
    // 🆕 NOVA: Salvar logs no localStorage (com controle de frequência)
    async saveLogsToStorage() {
      try {
        // Evitar salvamentos muito frequentes (mínimo 5 segundos entre salvamentos)
        const now = Date.now();
        if (now - this.lastSaveTime < 5000) {
          return;
        }

        // Verificar se o contexto da extensão ainda é válido
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
          console.warn('⚠️ Contexto da extensão invalidado - salvamento cancelado');
          return;
        }
        
        const logsToSave = this.consoleLogs.slice(-100); // Salvar apenas os últimos 100
        const logData = {
          logs: logsToSave,
          timestamp: now
        };

        // Usar StorageManager se disponível, senão usar localStorage
        if (window.storageManager) {
          await window.storageManager.store('bugSpotter_logs', logData, {
            compress: false, // Desabilitar compressão para evitar erros
            ttl: 2 * 60 * 60 * 1000, // 2 horas (reduzido)
            storage: 'local'
          });
        } else {
          localStorage.setItem('bugSpotter_logs', JSON.stringify(logData));
        }
        
        this.lastSaveTime = now;
      } catch (error) {
        // Silenciar erros de salvamento para evitar spam no console
        // console.error('Erro ao salvar logs:', error);
      }
    }

    addLog(level, args) {
      // Filtrar logs sobre corrupção para evitar loops infinitos
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      
      if (message.includes('mobime-pp') || 
          message.includes('Dados corrompidos') ||
          message.includes('Erro ao parsear JSON') ||
          message.includes('Detectado padrão de corrupção') ||
          message.includes('Removido dado corrompido')) {
        return; // Não salvar logs sobre corrupção
      }
      
      const logEntry = {
        level,
        message: message,
        timestamp: new Date().toISOString(),
        url: window.location.href,
        stack: level === 'error' ? new Error().stack : undefined
      };

      this.consoleLogs.push(logEntry);

      // Mantém apenas os últimos logs
      if (this.consoleLogs.length > this.maxLogs) {
        this.consoleLogs.shift();
      }

      // Ordenar logs por timestamp para manter ordem cronológica
      this.consoleLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      // Disponibiliza para o background script
      window.bugSpotterLogs = this.consoleLogs;
      
      // Salvar menos frequentemente (a cada 25 logs ou erros importantes)
      if (level === 'error' || this.consoleLogs.length % 25 === 0) {
        this.saveLogsToStorage();
      }
    }
  }

  // Inicializar apenas se não existir
  if (typeof window.bugSpotterContent === 'undefined') {
    // Criando instância global silenciosamente
    window.bugSpotterContent = new BugSpotterContent();
    window.BugSpotterContent = BugSpotterContent; // Expor classe também
  } else {
    // Instância já existe, pulando criação
  }

  // Listener para mensagens do background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getLogs') {
      sendResponse({ logs: window.bugSpotterContent.consoleLogs });
    } else if (message.action === 'capturePageState') {
      const pageState = window.bugSpotterContent.capturePageState();
      sendResponse({ pageState });
    }
    return true;
  });
}