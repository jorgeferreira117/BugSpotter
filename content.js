// Verificar se já foi inicializado para evitar duplicação
if (typeof window.bugSpotterContentInitialized === 'undefined') {
  window.bugSpotterContentInitialized = true;

  class BugSpotterContent {
    constructor() {
      this.consoleLogs = [];
      this.maxLogs = 500; // Aumentar para 500 logs
      this.init();
    }

    init() {
      this.interceptConsoleLogs();
      this.setupErrorHandling();
      this.injectPageScript();
      this.startContinuousCapture(); // Nova função
    }
  
    // 🆕 NOVA: Captura contínua desde o carregamento
    startContinuousCapture() {
      // Capturar logs imediatamente ao carregar
      this.captureExistingLogs();
      
      // Interceptar erros globais
      window.addEventListener('error', (event) => {
        this.addLog('error', [`${event.message} at ${event.filename}:${event.lineno}:${event.colno}`]);
      });
      
      // Interceptar promises rejeitadas
      window.addEventListener('unhandledrejection', (event) => {
        this.addLog('error', [`Unhandled Promise Rejection: ${event.reason}`]);
      });
      
      // Salvar logs no localStorage para persistência
      this.saveLogsToStorage();
      setInterval(() => this.saveLogsToStorage(), 5000); // Salvar a cada 5 segundos
    }
    
    // 🆕 NOVA: Capturar logs que já existem
    captureExistingLogs() {
      try {
        // Tentar recuperar logs salvos anteriormente
        const savedLogs = localStorage.getItem('bugSpotter_logs');
        if (savedLogs) {
          const parsed = JSON.parse(savedLogs);
          if (Array.isArray(parsed)) {
            this.consoleLogs = parsed.slice(-this.maxLogs); // Manter apenas os mais recentes
            console.log(`[BugSpotter] Logs anteriores recuperados: ${this.consoleLogs.length}`);
          }
        }
      } catch (e) {
        console.warn('[BugSpotter] Erro ao recuperar logs anteriores:', e);
      }
    }
    
    // 🆕 NOVA: Salvar logs no localStorage
    saveLogsToStorage() {
      try {
        localStorage.setItem('bugSpotter_logs', JSON.stringify(this.consoleLogs));
      } catch (e) {
        // Ignorar erros de quota exceeded
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