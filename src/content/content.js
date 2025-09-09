// Verificar se já foi inicializado para evitar duplicação
if (typeof window.bugSpotterContentInitialized === 'undefined') {
  window.bugSpotterContentInitialized = true;

  // Carregar módulo de storage se disponível
  if (typeof StorageManager !== 'undefined') {
    window.storageManager = new StorageManager();
  }

  class BugSpotterContent {
    constructor() {
      this.consoleLogs = [];
      this.maxLogs = 500; // Aumentar para 500 logs
      this.saveInterval = null;
      this.errorHandler = null;
      this.rejectionHandler = null;
      this.beforeUnloadHandler = null;
      this.init();
    }

    init() {
      this.interceptConsoleLogs();
      this.setupErrorHandling();
      this.injectPageScript();
      this.startContinuousCapture(); // Nova função
    }

    interceptConsoleLogs() {
      // Interceptar métodos do console
      const originalMethods = {};
      const consoleMethods = ['log', 'error', 'warn', 'info', 'debug'];
      
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
      // Injetar script na página se necessário
      // Por enquanto, apenas definir window.bugSpotterLogs
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
    
    // Método de cleanup centralizado
    cleanup() {
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
      
      // Salvar logs finais antes do cleanup
      this.saveLogsToStorage();
    }
    
    // 🆕 NOVA: Capturar logs que já existem
    async captureExistingLogs() {
      try {
        // Tentar recuperar logs salvos anteriormente
        let savedLogsData;
        
        if (window.storageManager) {
          savedLogsData = await window.storageManager.retrieve('bugSpotter_logs', 'local');
        } else {
          const savedLogs = localStorage.getItem('bugSpotter_logs');
          savedLogsData = savedLogs ? JSON.parse(savedLogs) : null;
        }
        if (savedLogsData && savedLogsData.logs && Array.isArray(savedLogsData.logs)) {
          this.consoleLogs = [...savedLogsData.logs];
          console.log(`Recuperados ${savedLogsData.logs.length} logs salvos`);
        }
      } catch (e) {
        console.warn('[BugSpotter] Erro ao recuperar logs anteriores:', e);
      }
    }
    
    // 🆕 NOVA: Salvar logs no localStorage
    async saveLogsToStorage() {
      try {
        const logsToSave = this.consoleLogs.slice(-100); // Salvar apenas os últimos 100
        const logData = {
          logs: logsToSave,
          timestamp: Date.now()
        };

        // Usar StorageManager se disponível, senão usar localStorage
        if (window.storageManager) {
          await window.storageManager.store('bugSpotter_logs', logData, {
            compress: true,
            ttl: 24 * 60 * 60 * 1000, // 24 horas
            storage: 'local'
          });
        } else {
          localStorage.setItem('bugSpotter_logs', JSON.stringify(logData));
        }
      } catch (error) {
        console.error('Erro ao salvar logs:', error);
      }
    }

    addLog(level, args) {
      const logEntry = {
        level,
        message: args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' '),
        timestamp: new Date().toISOString(),
        url: window.location.href,
        stack: level === 'error' ? new Error().stack : undefined
      };

      this.consoleLogs.push(logEntry);

      // Mantém apenas os últimos logs
      if (this.consoleLogs.length > this.maxLogs) {
        this.consoleLogs.shift();
      }

      // Disponibiliza para o background script
      window.bugSpotterLogs = this.consoleLogs;
      
      // Salvar periodicamente
      if (this.consoleLogs.length % 10 === 0) {
        this.saveLogsToStorage();
      }
    }
  }

  // Inicializar apenas se não existir
  if (typeof window.bugSpotterContent === 'undefined') {
    window.bugSpotterContent = new BugSpotterContent();
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