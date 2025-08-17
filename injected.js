// Script injetado diretamente na página para capturar informações adicionais
(function() {
  'use strict';

  // Captura informações de performance
  window.bugSpotterPerformance = {
    navigation: performance.getEntriesByType('navigation')[0],
    resources: performance.getEntriesByType('resource'),
    marks: performance.getEntriesByType('mark'),
    measures: performance.getEntriesByType('measure')
  };

  // Captura informações de rede
  const originalFetch = window.fetch;
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  window.bugSpotterNetworkLogs = [];

  // Intercepta fetch
  window.fetch = function(...args) {
    const startTime = Date.now();
    const url = args[0];
    
    return originalFetch.apply(this, args)
      .then(response => {
        window.bugSpotterNetworkLogs.push({
          type: 'fetch',
          url: url,
          method: args[1]?.method || 'GET',
          status: response.status,
          statusText: response.statusText,
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString()
        });
        return response;
      })
      .catch(error => {
        window.bugSpotterNetworkLogs.push({
          type: 'fetch',
          url: url,
          method: args[1]?.method || 'GET',
          error: error.message,
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString()
        });
        throw error;
      });
  };

  // Intercepta XMLHttpRequest
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    this._bugSpotterData = {
      method,
      url,
      startTime: Date.now()
    };
    return originalXHROpen.apply(this, [method, url, ...args]);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    if (this._bugSpotterData) {
      this.addEventListener('loadend', () => {
        window.bugSpotterNetworkLogs.push({
          type: 'xhr',
          url: this._bugSpotterData.url,
          method: this._bugSpotterData.method,
          status: this.status,
          statusText: this.statusText,
          duration: Date.now() - this._bugSpotterData.startTime,
          timestamp: new Date().toISOString()
        });
      });
    }
    return originalXHRSend.apply(this, args);
  };

  // Captura informações do localStorage e sessionStorage
  window.bugSpotterStorageInfo = {
    localStorage: { ...localStorage },
    sessionStorage: { ...sessionStorage },
    cookies: document.cookie
  };

})();