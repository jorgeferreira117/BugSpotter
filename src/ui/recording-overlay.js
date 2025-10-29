class RecordingOverlay {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    this.timeRemaining = 30; // segundos
    this.maxDuration = 30;
    this.timerInterval = null;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.stream = null;
    
    this.init();
  }

  init() {
    this.bindEvents();
    this.makeDraggable();
    this.updateDisplay();
    
    // Receber configurações da extensão
    this.getRecordingSettings();
  }

  bindEvents() {
    const playBtn = document.getElementById('playBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const stopBtn = document.getElementById('stopBtn');

    playBtn.addEventListener('click', () => this.startRecording());
    pauseBtn.addEventListener('click', () => this.pauseRecording());
    stopBtn.addEventListener('click', () => this.stopRecording());

    // Escutar mensagens da extensão
    window.addEventListener('message', (event) => {
      // Aceitar mensagens do parent frame (content script)
      if (event.source !== window.parent && event.source !== window) return;
      
      if (event.data.type === 'RECORDING_CONFIG') {
        this.maxDuration = event.data.maxDuration || 30;
        this.timeRemaining = this.maxDuration;
        this.updateDisplay();
      } else if (event.data.type === 'INIT_OVERLAY') {
        // Configurações iniciais do overlay
        const config = event.data.config || {};
        this.maxDuration = config.maxDuration || 30;
        this.timeRemaining = this.maxDuration;
        this.updateDisplay();
        console.log('Overlay initialized with settings:', config);
      } else if (event.data.type === 'RESTORE_RECORDING_STATE') {
        // Restaurar estado de gravação após navegação
        this.restoreRecordingState(event.data.state);
      }
    });
  }

  makeDraggable() {
    const overlay = document.getElementById('recordingOverlay');
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    overlay.addEventListener('mousedown', (e) => {
      if (e.target.closest('.control-btn')) return;
      
      initialX = e.clientX - xOffset;
      initialY = e.clientY - yOffset;
      isDragging = true;
      overlay.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
      xOffset = currentX;
      yOffset = currentY;
      
      overlay.style.transform = `translate(${currentX}px, ${currentY}px)`;
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      overlay.style.cursor = 'move';
    });
  }

  async getRecordingSettings() {
    try {
      // Solicitar configurações da extensão
      window.postMessage({ type: 'GET_RECORDING_CONFIG' }, '*');
    } catch (error) {
      console.error('Error fetching settings:', error);
    }
  }

  async startRecording() {
    try {
      this.updateStatus('Starting recording...');
      
      // Obter stream de captura de tela
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { 
          mediaSource: 'screen',
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        }
      });

      // Configurar MediaRecorder
      const options = { 
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 1000000,
        audioBitsPerSecond: 128000
      };
      
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/webm;codecs=vp8';
        options.videoBitsPerSecond = 800000;
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
          options.mimeType = 'video/webm';
          options.videoBitsPerSecond = 600000;
        }
      }

      this.mediaRecorder = new MediaRecorder(this.stream, options);
      this.recordedChunks = [];

      // Event listeners do MediaRecorder
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.handleRecordingComplete();
      };

      this.mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event.error);
        this.updateStatus('Recording error');
        this.resetRecording();
      };

      // Detectar quando o usuário para o compartilhamento
      this.stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (this.isRecording) {
          this.updateStatus('Compartilhamento encerrado');
          this.stopRecording();
        }
      });

      // Iniciar gravação
      this.mediaRecorder.start(1000);
      this.isRecording = true;
      this.isPaused = false;
      
      this.startTimer();
      this.updateButtons();
      this.updateStatus('Gravando...');
      
      // Notificar extensão
      this.notifyExtension('RECORDING_STARTED');
      
    } catch (error) {
      console.error('Error starting recording:', error);
      
      let errorMessage = 'Failed to start recording';
      if (error.name === 'NotAllowedError') {
        errorMessage = 'Permission denied';
      } else if (error.name === 'NotSupportedError') {
        errorMessage = 'Not supported in this browser';
      } else if (error.name === 'NotFoundError') {
        errorMessage = 'No screen available';
      }
      
      this.updateStatus(errorMessage);
      this.resetRecording();
    }
  }

  pauseRecording() {
    if (!this.isRecording || this.isPaused) return;
    
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
      this.isPaused = true;
      this.stopTimer();
      this.updateButtons();
      this.updateStatus('Paused');
      
      this.notifyExtension('RECORDING_PAUSED');
    }
  }

  resumeRecording() {
    if (!this.isRecording || !this.isPaused) return;
    
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
      this.isPaused = false;
      this.startTimer();
      this.updateButtons();
      this.updateStatus('Gravando...');
      
      this.notifyExtension('RECORDING_RESUMED');
    }
  }

  stopRecording() {
    if (!this.isRecording) return;
    
    this.isRecording = false;
    this.isPaused = false;
    this.stopTimer();
    
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    
    this.updateButtons();
    this.updateStatus('Finalizando...');
    
    this.notifyExtension('RECORDING_STOPPED');
  }

  async handleRecordingComplete() {
    try {
      const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
      const duration = this.maxDuration - this.timeRemaining;
      
      // Verificar tamanho do arquivo
      const maxSize = 50 * 1024 * 1024; // 50MB
      if (blob.size > maxSize) {
        this.updateStatus('Arquivo muito grande (>50MB)');
        this.notifyExtension('RECORDING_ERROR', { error: 'File too large' });
        return;
      }
      
      // Converter para base64
      const reader = new FileReader();
      reader.onload = () => {
        const videoData = {
          type: 'recording',
          name: `screen_recording_${Date.now()}.webm`,
          data: reader.result,
          size: blob.size,
          duration: Math.round(duration)
        };
        
        // Enviar para extensão
        this.notifyExtension('RECORDING_COMPLETE', videoData);
        this.updateStatus('Recording saved!');
        
        // Fechar overlay após 2 segundos
        setTimeout(() => {
          this.closeOverlay();
        }, 2000);
      };
      
      reader.onerror = () => {
        this.updateStatus('Error processing recording');
        this.notifyExtension('RECORDING_ERROR', { error: 'Processing failed' });
      };
      
      reader.readAsDataURL(blob);
      
    } catch (error) {
      console.error('Error processing recording:', error);
      this.updateStatus('Error processing');
      this.notifyExtension('RECORDING_ERROR', { error: error.message });
    }
  }

  startTimer() {
    this.stopTimer(); // Limpar timer existente
    
    this.timerInterval = setInterval(() => {
      this.timeRemaining--;
      this.updateDisplay();
      
      if (this.timeRemaining <= 0) {
        this.stopRecording();
      }
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  updateDisplay() {
    const timerText = document.getElementById('timerText');
    const minutes = Math.floor(this.timeRemaining / 60);
    const seconds = this.timeRemaining % 60;
    timerText.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  updateButtons() {
    const playBtn = document.getElementById('playBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const stopBtn = document.getElementById('stopBtn');

    if (!this.isRecording) {
      // Estado inicial
      playBtn.classList.remove('hidden');
      pauseBtn.classList.add('hidden');
      playBtn.innerHTML = '▶';
    } else if (this.isPaused) {
      // Estado pausado
      playBtn.classList.remove('hidden');
      pauseBtn.classList.add('hidden');
      playBtn.innerHTML = '▶';
      playBtn.onclick = () => this.resumeRecording();
    } else {
      // Estado gravando
      playBtn.classList.add('hidden');
      pauseBtn.classList.remove('hidden');
    }
  }

  updateStatus(message) {
    const statusText = document.getElementById('statusText');
    statusText.textContent = message;
  }

  resetRecording() {
    this.isRecording = false;
    this.isPaused = false;
    this.timeRemaining = this.maxDuration;
    this.stopTimer();
    this.updateDisplay();
    this.updateButtons();
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  notifyExtension(type, data = {}) {
    // Enviar mensagem para content script que repassará para a extensão
    window.parent.postMessage({
      type: 'RECORDING_OVERLAY_MESSAGE',
      action: type,
      data: data
    }, '*');
  }

  closeOverlay() {
    // Remover overlay da página
    const overlay = document.getElementById('recordingOverlay');
    if (overlay) {
      overlay.remove();
    }
    
    // Notificar extensão que overlay foi fechado
    this.notifyExtension('OVERLAY_CLOSED');
  }
  
  restoreRecordingState(state) {
    console.log('[RecordingOverlay] Restoring recording state:', state);
    
    try {
      // Restaurar configurações
      this.maxDuration = state.maxDuration || 30;
      this.timeRemaining = state.timeRemaining || this.maxDuration;
      this.isRecording = state.isRecording || false;
      this.isPaused = state.isPaused || false;
      
      // Atualizar interface visual
      this.updateDisplay();
      this.updateButtons();
      
      // Se estava gravando, continuar o timer
      if (this.isRecording && !this.isPaused) {
        this.startTimer();
        this.updateStatus('Recording restored after navigation');
      } else if (this.isPaused) {
        this.updateStatus('Recording paused - click to continue');
      }
      
      console.log('[RecordingOverlay] State restored successfully');
    } catch (error) {
      console.error('[RecordingOverlay] Error restoring state:', error);
      this.updateStatus('Error restoring recording');
    }
  }
}

// Inicializar quando DOM estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new RecordingOverlay();
  });
} else {
  new RecordingOverlay();
}