// Verificar se já foi inicializado para evitar duplicação
if (typeof window.bugSpotterContentInitialized === 'undefined') {
  window.bugSpotterContentInitialized = true;

  class BugSpotterContent {
    constructor() {
      this.consoleLogs = [];
      this.maxLogs = 100;
      this.init();
    }

    init() {
      this.interceptConsoleLogs();
      this.setupErrorHandling();
      this.injectPageScript();
    }

    interceptConsoleLogs() {
      // Salva referências originais
      const originalLog = console.log;
      const originalError = console.error;
      const originalWarn = console.warn;
      const originalInfo = console.info;

      // Intercepta console.log
      console.log = (...args) => {
        this.addLog('log', args);
        originalLog.apply(console, args);
      };

      // Intercepta console.error
      console.error = (...args) => {
        this.addLog('error', args);
        originalError.apply(console, args);
      };

      // Intercepta console.warn
      console.warn = (...args) => {
        this.addLog('warn', args);
        originalWarn.apply(console, args);
      };

      // Intercepta console.info
      console.info = (...args) => {
        this.addLog('info', args);
        originalInfo.apply(console, args);
      };
    }

    addLog(level, args) {
      const logEntry = {
        level,
        message: args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' '),
        timestamp: new Date().toISOString(),
        url: window.location.href
      };

      this.consoleLogs.push(logEntry);

      // Mantém apenas os últimos logs
      if (this.consoleLogs.length > this.maxLogs) {
        this.consoleLogs.shift();
      }

      // Disponibiliza para o background script
      window.bugSpotterLogs = this.consoleLogs;
    }

    setupErrorHandling() {
      // Captura erros JavaScript
      window.addEventListener('error', (event) => {
        this.addLog('error', [`JavaScript Error: ${event.message}`, `File: ${event.filename}:${event.lineno}:${event.colno}`]);
      });

      // Captura erros de Promise rejeitadas
      window.addEventListener('unhandledrejection', (event) => {
        this.addLog('error', [`Unhandled Promise Rejection: ${event.reason}`]);
      });

      // Captura erros de recursos
      window.addEventListener('error', (event) => {
        if (event.target !== window) {
          this.addLog('error', [`Resource Error: ${event.target.src || event.target.href}`, `Type: ${event.target.tagName}`]);
        }
      }, true);
    }

    injectPageScript() {
      // Injeta script na página para capturar mais informações
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected.js');
      script.onload = function() {
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
    }

    // Método para capturar estado atual da página
    capturePageState() {
      return {
        url: window.location.href,
        title: document.title,
        userAgent: navigator.userAgent,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        scroll: {
          x: window.scrollX,
          y: window.scrollY
        },
        timestamp: new Date().toISOString(),
        logs: this.consoleLogs
      };
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