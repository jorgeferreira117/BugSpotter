/**
 * Utilitário para controle de taxa de requisições
 */
class RateLimiter {
  constructor(maxRequests = 10, timeWindow = 60000) {
    this.maxRequests = maxRequests;
    this.timeWindow = timeWindow;
    this.requests = [];
  }
  
  canMakeRequest() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.timeWindow);
    return this.requests.length < this.maxRequests;
  }

  recordRequest() {
    this.requests.push(Date.now());
  }

  getRemainingRequests() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.timeWindow);
    return Math.max(0, this.maxRequests - this.requests.length);
  }

  getTimeUntilReset() {
    if (this.requests.length === 0) return 0;
    const oldestRequest = Math.min(...this.requests);
    const timeUntilReset = this.timeWindow - (Date.now() - oldestRequest);
    return Math.max(0, timeUntilReset);
  }
}

// Export para uso em outros módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RateLimiter;
} else if (typeof window !== 'undefined') {
  window.RateLimiter = RateLimiter;
}