/**
 * VideoCompressor - Módulo para compressão eficiente de vídeos
 * Implementa múltiplas estratégias de compressão para otimizar o armazenamento
 */
class VideoCompressor {
  constructor(options = {}) {
    this.options = {
      // Configurações padrão de compressão
      quality: options.quality || 0.8, // 0.1 a 1.0
      maxWidth: options.maxWidth || 1280,
      maxHeight: options.maxHeight || 720,
      frameRate: options.frameRate || 15, // FPS reduzido para menor tamanho
      videoBitrate: options.videoBitrate || 500000, // 500kbps
      audioBitrate: options.audioBitrate || 64000, // 64kbps
      format: options.format || 'webm', // webm, mp4
      codec: options.codec || 'vp9', // vp9, vp8, h264
      enableAudio: options.enableAudio !== false,
      compressionLevel: options.compressionLevel || 'medium', // low, medium, high, ultra
      ...options
    };
    
    this.compressionProfiles = {
      low: {
        quality: 0.9,
        maxWidth: 1920,
        maxHeight: 1080,
        frameRate: 30,
        videoBitrate: 1000000,
        audioBitrate: 128000
      },
      medium: {
        quality: 0.8,
        maxWidth: 1280,
        maxHeight: 720,
        frameRate: 15,
        videoBitrate: 500000,
        audioBitrate: 64000
      },
      high: {
        quality: 0.6,
        maxWidth: 854,
        maxHeight: 480,
        frameRate: 10,
        videoBitrate: 250000,
        audioBitrate: 32000
      },
      ultra: {
        quality: 0.4,
        maxWidth: 640,
        maxHeight: 360,
        frameRate: 8,
        videoBitrate: 150000,
        audioBitrate: 24000
      }
    };
    
    this.stats = {
      totalCompressions: 0,
      totalOriginalSize: 0,
      totalCompressedSize: 0,
      averageCompressionRatio: 0,
      compressionTime: 0
    };
  }
  
  /**
   * Comprime um blob de vídeo
   * @param {Blob} videoBlob - Blob do vídeo original
   * @param {Object} options - Opções específicas de compressão
   * @returns {Promise<Object>} - Resultado da compressão
   */
  async compressVideo(videoBlob, options = {}) {
    const startTime = performance.now();
    const originalSize = videoBlob.size;
    
    try {
      console.log(`🎬 [VideoCompressor] Iniciando compressão de vídeo (${this.formatBytes(originalSize)})`);
      
      // Aplicar perfil de compressão
      const compressionOptions = this.getCompressionOptions(options);
      
      // Escolher método de compressão baseado no tamanho e suporte do navegador
      let compressedBlob;
      
      if (this.supportsOffscreenCanvas() && originalSize > 10 * 1024 * 1024) {
        // Para vídeos grandes, usar compressão com OffscreenCanvas
        compressedBlob = await this.compressWithOffscreenCanvas(videoBlob, compressionOptions);
      } else if (this.supportsWebCodecs()) {
        // Usar WebCodecs API se disponível (mais eficiente)
        compressedBlob = await this.compressWithWebCodecs(videoBlob, compressionOptions);
      } else {
        // Fallback para compressão com MediaRecorder
        compressedBlob = await this.compressWithMediaRecorder(videoBlob, compressionOptions);
      }
      
      const compressionTime = performance.now() - startTime;
      const compressedSize = compressedBlob.size;
      const compressionRatio = ((originalSize - compressedSize) / originalSize * 100);
      
      // Atualizar estatísticas
      this.updateStats(originalSize, compressedSize, compressionTime);
      
      const result = {
        success: true,
        originalBlob: videoBlob,
        compressedBlob: compressedBlob,
        originalSize: originalSize,
        compressedSize: compressedSize,
        compressionRatio: compressionRatio,
        compressionTime: compressionTime,
        method: this.getUsedMethod(),
        options: compressionOptions
      };
      
      console.log(`✅ [VideoCompressor] Compressão concluída:`);
      console.log(`   Original: ${this.formatBytes(originalSize)}`);
      console.log(`   Comprimido: ${this.formatBytes(compressedSize)}`);
      console.log(`   Economia: ${compressionRatio.toFixed(1)}%`);
      console.log(`   Tempo: ${compressionTime.toFixed(0)}ms`);
      
      return result;
      
    } catch (error) {
      console.error('❌ [VideoCompressor] Erro na compressão:', error);
      
      return {
        success: false,
        error: error.message,
        originalBlob: videoBlob,
        compressedBlob: videoBlob, // Retorna original em caso de erro
        originalSize: originalSize,
        compressedSize: originalSize,
        compressionRatio: 0,
        compressionTime: performance.now() - startTime
      };
    }
  }
  
  /**
   * Compressão usando OffscreenCanvas (para vídeos grandes)
   */
  async compressWithOffscreenCanvas(videoBlob, options) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.src = URL.createObjectURL(videoBlob);
      
      video.onloadedmetadata = async () => {
        try {
          const canvas = new OffscreenCanvas(options.maxWidth, options.maxHeight);
          const ctx = canvas.getContext('2d');
          
          // Calcular dimensões mantendo aspect ratio
          const { width, height } = this.calculateDimensions(
            video.videoWidth, 
            video.videoHeight, 
            options.maxWidth, 
            options.maxHeight
          );
          
          canvas.width = width;
          canvas.height = height;
          
          const chunks = [];
          const stream = canvas.captureStream(options.frameRate);
          
          // Configurar MediaRecorder com configurações otimizadas
          const mediaRecorder = new MediaRecorder(stream, {
            mimeType: `video/${options.format};codecs=${options.codec}`,
            videoBitsPerSecond: options.videoBitrate
          });
          
          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              chunks.push(event.data);
            }
          };
          
          mediaRecorder.onstop = () => {
            const compressedBlob = new Blob(chunks, { type: `video/${options.format}` });
            URL.revokeObjectURL(video.src);
            resolve(compressedBlob);
          };
          
          mediaRecorder.onerror = (error) => {
            URL.revokeObjectURL(video.src);
            reject(error);
          };
          
          // Iniciar gravação
          mediaRecorder.start();
          
          // Renderizar frames do vídeo no canvas
          const renderFrame = () => {
            if (video.currentTime < video.duration) {
              ctx.drawImage(video, 0, 0, width, height);
              video.currentTime += 1 / options.frameRate;
              requestAnimationFrame(renderFrame);
            } else {
              mediaRecorder.stop();
            }
          };
          
          video.currentTime = 0;
          renderFrame();
          
        } catch (error) {
          URL.revokeObjectURL(video.src);
          reject(error);
        }
      };
      
      video.onerror = () => {
        URL.revokeObjectURL(video.src);
        reject(new Error('Erro ao carregar vídeo'));
      };
    });
  }
  
  /**
   * Compressão usando WebCodecs API (mais eficiente)
   */
  async compressWithWebCodecs(videoBlob, options) {
    // Implementação futura da WebCodecs API
    // Por enquanto, fazer fallback para MediaRecorder
    return this.compressWithMediaRecorder(videoBlob, options);
  }
  
  /**
   * Compressão usando MediaRecorder (fallback)
   */
  async compressWithMediaRecorder(videoBlob, options) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.src = URL.createObjectURL(videoBlob);
      video.muted = true;
      
      video.onloadedmetadata = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Calcular dimensões
        const { width, height } = this.calculateDimensions(
          video.videoWidth, 
          video.videoHeight, 
          options.maxWidth, 
          options.maxHeight
        );
        
        canvas.width = width;
        canvas.height = height;
        
        // Capturar stream do canvas
        const stream = canvas.captureStream(options.frameRate);
        
        // Adicionar áudio se habilitado
        if (options.enableAudio) {
          // Criar contexto de áudio para processar o áudio do vídeo original
          const audioContext = new AudioContext();
          const source = audioContext.createMediaElementSource(video);
          const destination = audioContext.createMediaStreamDestination();
          source.connect(destination);
          
          // Adicionar track de áudio ao stream
          destination.stream.getAudioTracks().forEach(track => {
            stream.addTrack(track);
          });
        }
        
        const chunks = [];
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: `video/${options.format};codecs=${options.codec}`,
          videoBitsPerSecond: options.videoBitrate,
          audioBitsPerSecond: options.audioBitrate
        });
        
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };
        
        mediaRecorder.onstop = () => {
          const compressedBlob = new Blob(chunks, { type: `video/${options.format}` });
          URL.revokeObjectURL(video.src);
          resolve(compressedBlob);
        };
        
        mediaRecorder.onerror = (error) => {
          URL.revokeObjectURL(video.src);
          reject(error);
        };
        
        // Iniciar gravação
        mediaRecorder.start();
        
        // Reproduzir vídeo e desenhar frames no canvas
        const drawFrame = () => {
          if (!video.paused && !video.ended) {
            ctx.drawImage(video, 0, 0, width, height);
            requestAnimationFrame(drawFrame);
          }
        };
        
        video.onplay = drawFrame;
        video.onended = () => {
          mediaRecorder.stop();
        };
        
        video.play();
      };
      
      video.onerror = () => {
        URL.revokeObjectURL(video.src);
        reject(new Error('Erro ao carregar vídeo'));
      };
    });
  }
  
  /**
   * Calcula dimensões mantendo aspect ratio
   */
  calculateDimensions(originalWidth, originalHeight, maxWidth, maxHeight) {
    const aspectRatio = originalWidth / originalHeight;
    
    let width = originalWidth;
    let height = originalHeight;
    
    if (width > maxWidth) {
      width = maxWidth;
      height = width / aspectRatio;
    }
    
    if (height > maxHeight) {
      height = maxHeight;
      width = height * aspectRatio;
    }
    
    // Garantir que as dimensões sejam pares (requisito de alguns codecs)
    width = Math.floor(width / 2) * 2;
    height = Math.floor(height / 2) * 2;
    
    return { width, height };
  }
  
  /**
   * Obtém opções de compressão baseadas no perfil
   */
  getCompressionOptions(customOptions = {}) {
    const profile = this.compressionProfiles[this.options.compressionLevel] || this.compressionProfiles.medium;
    
    return {
      ...this.options,
      ...profile,
      ...customOptions
    };
  }
  
  /**
   * Verifica suporte para OffscreenCanvas
   */
  supportsOffscreenCanvas() {
    return typeof OffscreenCanvas !== 'undefined';
  }
  
  /**
   * Verifica suporte para WebCodecs
   */
  supportsWebCodecs() {
    return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';
  }
  
  /**
   * Retorna o método de compressão usado
   */
  getUsedMethod() {
    if (this.supportsOffscreenCanvas()) return 'OffscreenCanvas';
    if (this.supportsWebCodecs()) return 'WebCodecs';
    return 'MediaRecorder';
  }
  
  /**
   * Atualiza estatísticas de compressão
   */
  updateStats(originalSize, compressedSize, compressionTime) {
    this.stats.totalCompressions++;
    this.stats.totalOriginalSize += originalSize;
    this.stats.totalCompressedSize += compressedSize;
    this.stats.compressionTime += compressionTime;
    
    this.stats.averageCompressionRatio = 
      ((this.stats.totalOriginalSize - this.stats.totalCompressedSize) / this.stats.totalOriginalSize * 100);
  }
  
  /**
   * Obtém estatísticas de compressão
   */
  getStats() {
    return {
      ...this.stats,
      averageOriginalSize: this.stats.totalOriginalSize / Math.max(this.stats.totalCompressions, 1),
      averageCompressedSize: this.stats.totalCompressedSize / Math.max(this.stats.totalCompressions, 1),
      averageCompressionTime: this.stats.compressionTime / Math.max(this.stats.totalCompressions, 1),
      totalSpaceSaved: this.stats.totalOriginalSize - this.stats.totalCompressedSize
    };
  }
  
  /**
   * Formata bytes em formato legível
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  /**
   * Redefine estatísticas
   */
  resetStats() {
    this.stats = {
      totalCompressions: 0,
      totalOriginalSize: 0,
      totalCompressedSize: 0,
      averageCompressionRatio: 0,
      compressionTime: 0
    };
  }
  
  /**
   * Configura perfil de compressão
   */
  setCompressionLevel(level) {
    if (this.compressionProfiles[level]) {
      this.options.compressionLevel = level;
      console.log(`📊 [VideoCompressor] Perfil de compressão alterado para: ${level}`);
    } else {
      console.warn(`⚠️ [VideoCompressor] Perfil '${level}' não encontrado`);
    }
  }
  
  /**
   * Estima o tamanho final após compressão
   */
  estimateCompressedSize(originalSize, compressionLevel = null) {
    const level = compressionLevel || this.options.compressionLevel;
    const profile = this.compressionProfiles[level] || this.compressionProfiles.medium;
    
    // Estimativa baseada na qualidade e bitrate
    const estimatedRatio = 1 - profile.quality;
    return Math.floor(originalSize * estimatedRatio);
  }
}

// Exportar para uso em outros módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VideoCompressor;
} else if (typeof globalThis !== 'undefined') {
  globalThis.VideoCompressor = VideoCompressor;
}