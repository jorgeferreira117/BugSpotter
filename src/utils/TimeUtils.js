/**
 * Utilitários de tempo unificados para o BugSpotter
 * Consolida toda a lógica de formatação e manipulação de tempo
 */

class TimeUtils {
  /**
   * Formata duração em segundos para formato MM:SS
   * @param {number} seconds - Duração em segundos
   * @returns {string} Tempo formatado (ex: "02:30")
   */
  static formatDuration(seconds) {
    if (typeof seconds !== 'number' || seconds < 0) {
      return '00:00';
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  /**
   * Formata duração em segundos para formato HH:MM:SS
   * @param {number} seconds - Duração em segundos
   * @returns {string} Tempo formatado (ex: "01:02:30")
   */
  static formatDurationLong(seconds) {
    if (typeof seconds !== 'number' || seconds < 0) {
      return '00:00:00';
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  /**
   * Parse de string de tempo MM:SS para segundos
   * @param {string} timeStr - String no formato "MM:SS"
   * @returns {number} Duração em segundos
   */
  static parseTimeString(timeStr) {
    if (typeof timeStr !== 'string') {
      return 0;
    }

    const parts = timeStr.split(':');
    if (parts.length !== 2) {
      return 0;
    }

    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);

    if (isNaN(minutes) || isNaN(seconds)) {
      return 0;
    }

    return (minutes * 60) + seconds;
  }

  /**
   * Parse de string de tempo HH:MM:SS para segundos
   * @param {string} timeStr - String no formato "HH:MM:SS"
   * @returns {number} Duração em segundos
   */
  static parseTimeStringLong(timeStr) {
    if (typeof timeStr !== 'string') {
      return 0;
    }

    const parts = timeStr.split(':');
    if (parts.length !== 3) {
      return 0;
    }

    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseInt(parts[2], 10);

    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
      return 0;
    }

    return (hours * 3600) + (minutes * 60) + seconds;
  }

  /**
   * Formata timestamp para data/hora legível
   * @param {number|Date} timestamp - Timestamp ou objeto Date
   * @param {string} format - Formato de saída ('short', 'long', 'time', 'date')
   * @returns {string} Data/hora formatada
   */
  static formatTimestamp(timestamp, format = 'short') {
    let date;
    
    if (timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === 'number') {
      date = new Date(timestamp);
    } else {
      return 'Invalid date';
    }

    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }

    const options = {
      short: {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      },
      long: {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      },
      time: {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      },
      date: {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }
    };

    return date.toLocaleString('pt-BR', options[format] || options.short);
  }

  /**
   * Calcula tempo relativo (ex: "há 5 minutos")
   * @param {number|Date} timestamp - Timestamp ou objeto Date
   * @returns {string} Tempo relativo formatado
   */
  static getRelativeTime(timestamp) {
    let date;
    
    if (timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === 'number') {
      date = new Date(timestamp);
    } else {
      return 'Invalid date';
    }

    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) {
      return 'just now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes === 1 ? '1 minute' : diffMinutes + ' minutes'} ago`;
    } else if (diffHours < 24) {
      return `${diffHours === 1 ? '1 hour' : diffHours + ' hours'} ago`;
    } else if (diffDays < 7) {
      return `há ${diffDays} dia${diffDays !== 1 ? 's' : ''}`;
    } else {
      return this.formatTimestamp(date, 'date');
    }
  }

  /**
   * Cria um timer que executa callback a cada intervalo
   * @param {Function} callback - Função a ser executada
   * @param {number} intervalMs - Intervalo em milissegundos
   * @returns {Object} Objeto com métodos start, stop, pause, resume
   */
  static createTimer(callback, intervalMs = 1000) {
    let intervalId = null;
    let isRunning = false;
    let isPaused = false;
    let startTime = null;
    let pausedTime = 0;

    return {
      start() {
        if (isRunning) return;
        
        isRunning = true;
        isPaused = false;
        startTime = Date.now();
        pausedTime = 0;
        
        intervalId = setInterval(() => {
          if (!isPaused) {
            const elapsed = Math.floor((Date.now() - startTime - pausedTime) / 1000);
            callback(elapsed);
          }
        }, intervalMs);
      },

      stop() {
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        isRunning = false;
        isPaused = false;
        startTime = null;
        pausedTime = 0;
      },

      pause() {
        if (isRunning && !isPaused) {
          isPaused = true;
          pausedTime += Date.now() - startTime;
        }
      },

      resume() {
        if (isRunning && isPaused) {
          isPaused = false;
          startTime = Date.now();
        }
      },

      isRunning() {
        return isRunning;
      },

      isPaused() {
        return isPaused;
      },

      getElapsed() {
        if (!isRunning) return 0;
        return Math.floor((Date.now() - startTime - pausedTime) / 1000);
      }
    };
  }

  /**
   * Cria um countdown timer
   * @param {number} durationSeconds - Duração total em segundos
   * @param {Function} onTick - Callback executado a cada segundo (recebe segundos restantes)
   * @param {Function} onComplete - Callback executado quando o timer termina
   * @returns {Object} Objeto com métodos start, stop, pause, resume
   */
  static createCountdown(durationSeconds, onTick, onComplete) {
    let remainingSeconds = durationSeconds;
    let intervalId = null;
    let isRunning = false;
    let isPaused = false;

    return {
      start() {
        if (isRunning) return;
        
        isRunning = true;
        isPaused = false;
        
        // Executar callback inicial
        if (onTick) onTick(remainingSeconds);
        
        intervalId = setInterval(() => {
          if (!isPaused) {
            remainingSeconds--;
            
            if (onTick) onTick(remainingSeconds);
            
            if (remainingSeconds <= 0) {
              this.stop();
              if (onComplete) onComplete();
            }
          }
        }, 1000);
      },

      stop() {
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        isRunning = false;
        isPaused = false;
      },

      pause() {
        isPaused = true;
      },

      resume() {
        isPaused = false;
      },

      reset(newDuration = durationSeconds) {
        this.stop();
        remainingSeconds = newDuration;
        durationSeconds = newDuration;
      },

      getRemaining() {
        return remainingSeconds;
      },

      isRunning() {
        return isRunning;
      },

      isPaused() {
        return isPaused;
      }
    };
  }

  /**
   * Debounce function - executa função apenas após período de inatividade
   * @param {Function} func - Função a ser executada
   * @param {number} waitMs - Tempo de espera em milissegundos
   * @returns {Function} Função debounced
   */
  static debounce(func, waitMs) {
    let timeoutId;
    
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeoutId);
        func.apply(this, args);
      };
      
      clearTimeout(timeoutId);
      timeoutId = setTimeout(later, waitMs);
    };
  }

  /**
   * Throttle function - limita execução da função a um intervalo específico
   * @param {Function} func - Função a ser executada
   * @param {number} limitMs - Limite de tempo em milissegundos
   * @returns {Function} Função throttled
   */
  static throttle(func, limitMs) {
    let inThrottle;
    
    return function executedFunction(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limitMs);
      }
    };
  }

  /**
   * Converte milissegundos para objeto com unidades
   * @param {number} ms - Milissegundos
   * @returns {Object} Objeto com days, hours, minutes, seconds, milliseconds
   */
  static msToTimeUnits(ms) {
    if (typeof ms !== 'number' || ms < 0) {
      return { days: 0, hours: 0, minutes: 0, seconds: 0, milliseconds: 0 };
    }

    const milliseconds = ms % 1000;
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));

    return { days, hours, minutes, seconds, milliseconds };
  }

  /**
   * Converte objeto de unidades de tempo para milissegundos
   * @param {Object} timeUnits - Objeto com days, hours, minutes, seconds, milliseconds
   * @returns {number} Total em milissegundos
   */
  static timeUnitsToMs(timeUnits) {
    const {
      days = 0,
      hours = 0,
      minutes = 0,
      seconds = 0,
      milliseconds = 0
    } = timeUnits;

    return (
      days * 24 * 60 * 60 * 1000 +
      hours * 60 * 60 * 1000 +
      minutes * 60 * 1000 +
      seconds * 1000 +
      milliseconds
    );
  }
}

// Exportar para uso em outros módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TimeUtils;
} else if (typeof window !== 'undefined') {
  window.TimeUtils = TimeUtils;
}