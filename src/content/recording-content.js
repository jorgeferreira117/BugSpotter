// Content script para gerenciar o overlay de gravação
// Verificar se já foi injetado para evitar múltiplas instâncias
if (window.recordingContentScriptInjected) {
  console.log('Recording content script já foi injetado');
} else {
  window.recordingContentScriptInjected = true;

class RecordingContentScript {
  constructor() {
    this.overlayInjected = false;
    this.init();
  }

  init() {
    // Escutar mensagens da extensão
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleExtensionMessage(message, sender, sendResponse);
      return true; // Manter canal aberto para resposta assíncrona
    });

    // Escutar mensagens do overlay
    window.addEventListener('message', (event) => {
      // Aceitar mensagens do iframe overlay
      if (event.source !== window && !event.source.frameElement) return;
      this.handleOverlayMessage(event.data);
    });
  }

  async handleExtensionMessage(message, sender, sendResponse) {
    try {
      switch (message.action) {
        case 'INJECT_RECORDING_OVERLAY':
          await this.injectRecordingOverlay(message.config);
          sendResponse({ success: true });
          break;

        case 'REMOVE_RECORDING_OVERLAY':
          this.removeRecordingOverlay();
          sendResponse({ success: true });
          break;

        case 'UPDATE_RECORDING_CONFIG':
          this.updateOverlayConfig(message.config);
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Erro no content script:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  handleOverlayMessage(data) {
    if (data.type !== 'RECORDING_OVERLAY_MESSAGE') return;

    // Repassar mensagens do overlay para a extensão
    chrome.runtime.sendMessage({
      action: 'RECORDING_OVERLAY_EVENT',
      event: data.action,
      data: data.data
    }).catch(error => {
      console.error('Erro ao enviar mensagem para extensão:', error);
    });

    // Responder a solicitações específicas do overlay
    if (data.action === 'GET_RECORDING_CONFIG') {
      // Solicitar configurações da extensão
      chrome.runtime.sendMessage({ action: 'GET_RECORDING_CONFIG' })
        .then(response => {
          if (response && response.success) {
            window.postMessage({
              type: 'RECORDING_CONFIG',
              maxDuration: response.config.maxDuration || 30
            }, '*');
          }
        })
        .catch(error => {
          console.error('Erro ao obter configurações:', error);
        });
    }
  }

  async injectRecordingOverlay(config = {}) {
    if (this.overlayInjected) {
      console.log('Overlay já injetado');
      return;
    }

    try {
      // Criar div nativo em vez de iframe para evitar problemas de CSP
      const overlay = document.createElement('div');
      overlay.id = 'bugspotter-recording-overlay';
      
      // Define estilos para o overlay compacto
       Object.assign(overlay.style, {
         position: 'fixed',
         top: '20px',
         right: '20px',
         width: '180px',
         height: '35px',
         border: 'none',
         zIndex: '2147483647',
         borderRadius: '20px',
         boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
         backgroundColor: 'rgba(0, 0, 0, 0.85)',
         pointerEvents: 'auto',
         fontFamily: 'system-ui, -apple-system, sans-serif',
         color: 'white',
         padding: '4px 8px',
         display: 'flex',
         alignItems: 'center',
         justifyContent: 'space-between'
       });

      // Cria o conteúdo do overlay compacto
       overlay.innerHTML = `
         <div style="display: flex; align-items: center; gap: 6px;">
           <div style="width: 5px; height: 5px; background: #ff4444; border-radius: 50%; animation: pulse 1.5s infinite;"></div>
           <div id="timer" style="font-size: 12px; font-weight: bold; min-width: 30px;">30</div>
         </div>
         <div style="display: flex; gap: 3px;">
           <button id="playBtn" style="background: #4CAF50; border: none; border-radius: 50%; width: 20px; height: 20px; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 8px;">▶</button>
           <button id="pauseBtn" style="background: #FF9800; border: none; border-radius: 50%; width: 20px; height: 20px; color: white; cursor: pointer; display: none; align-items: center; justify-content: center; font-size: 8px;">⏸</button>
           <button id="stopBtn" style="background: #f44336; border: none; border-radius: 50%; width: 20px; height: 20px; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 8px;">⏹</button>
         </div>
       `;

      // Adiciona animação CSS
      const style = document.createElement('style');
      style.textContent = `
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
      `;
      document.head.appendChild(style);

      // Adiciona event listeners
      const playBtn = overlay.querySelector('#playBtn');
      const pauseBtn = overlay.querySelector('#pauseBtn');
      const stopBtn = overlay.querySelector('#stopBtn');
      const timer = overlay.querySelector('#timer');

      // Configuração do timer de countdown e captura de vídeo
       let maxDuration = config.maxDuration || 30; // Default 30 segundos
       let remainingTime = maxDuration;
       let timerInterval;
       let mediaRecorder = null;
       let recordedChunks = [];
       let stream = null;
 
       const updateTimer = () => {
         const minutes = Math.floor(remainingTime / 60);
         const seconds = remainingTime % 60;
         timer.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
         remainingTime--;
         
         if (remainingTime < 0) {
           // Tempo esgotado, parar gravação automaticamente
           clearInterval(timerInterval);
           stopRecording();
         }
       };

       const startRecording = async () => {
         try {
           // Solicitar captura de tela
           stream = await navigator.mediaDevices.getDisplayMedia({
             video: {
               mediaSource: 'screen',
               width: { ideal: 1920 },
               height: { ideal: 1080 },
               frameRate: { ideal: 30 }
             },
             audio: true
           });

           recordedChunks = [];
           mediaRecorder = new MediaRecorder(stream, {
             mimeType: 'video/webm;codecs=vp9'
           });

           mediaRecorder.ondataavailable = (event) => {
             if (event.data.size > 0) {
               recordedChunks.push(event.data);
             }
           };

           mediaRecorder.onstop = () => {
             const blob = new Blob(recordedChunks, { type: 'video/webm' });
             const reader = new FileReader();
             reader.onload = () => {
               // Enviar dados do vídeo para o background
               chrome.runtime.sendMessage({
                 action: 'RECORDING_COMPLETED',
                 videoData: reader.result,
                 videoSize: blob.size
               });
             };
             reader.readAsDataURL(blob);
           };

           mediaRecorder.start();
           
           // Detectar quando usuário para a captura de tela
           stream.getVideoTracks()[0].addEventListener('ended', () => {
             stopRecording();
           });

           console.log('Gravação iniciada');
         } catch (error) {
           console.error('Erro ao iniciar gravação:', error);
           chrome.runtime.sendMessage({
             action: 'RECORDING_FAILED',
             error: error.message
           });
         }
       };

       const stopRecording = () => {
         if (mediaRecorder && mediaRecorder.state !== 'inactive') {
           mediaRecorder.stop();
         }
         if (stream) {
           stream.getTracks().forEach(track => track.stop());
         }
         clearInterval(timerInterval);
         overlay.remove();
         this.overlayInjected = false;
       };

      playBtn.addEventListener('click', async () => {
         await startRecording();
         chrome.runtime.sendMessage({
           action: 'RECORDING_OVERLAY_EVENT',
           event: 'START_RECORDING'
         });
         playBtn.style.display = 'none';
         pauseBtn.style.display = 'flex';
         remainingTime = maxDuration;
         timerInterval = setInterval(updateTimer, 1000);
       });

      pauseBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({
          action: 'RECORDING_OVERLAY_EVENT',
          event: 'PAUSE_RECORDING'
        });
        pauseBtn.style.display = 'none';
        playBtn.style.display = 'flex';
        clearInterval(timerInterval);
      });

      stopBtn.addEventListener('click', () => {
        stopRecording();
        chrome.runtime.sendMessage({
          action: 'RECORDING_OVERLAY_EVENT',
          event: 'STOP_RECORDING'
        }, (response) => {
          console.log('Stop recording response:', response);
          // Abrir popup após parar gravação
          chrome.runtime.sendMessage({ action: 'openPopup' });
        });
      });

      // Adicionar ao DOM
      document.documentElement.appendChild(overlay);
      this.overlayInjected = true;

      console.log('Overlay de gravação nativo injetado com sucesso');

    } catch (error) {
      console.error('Erro ao injetar overlay:', error);
      throw error;
    }
  }

  removeRecordingOverlay() {
    const iframe = document.getElementById('bugspotter-recording-overlay');
    if (iframe) {
      iframe.remove();
      this.overlayInjected = false;
      console.log('Overlay de gravação removido');
    }
  }

  updateOverlayConfig(config) {
    if (!this.overlayInjected) return;

    const iframe = document.getElementById('bugspotter-recording-overlay');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        type: 'RECORDING_CONFIG',
        maxDuration: config.maxDuration || 30
      }, '*');
    }
  }
}

// Inicializar content script
if (typeof window !== 'undefined' && window.chrome && chrome.runtime) {
  new RecordingContentScript();
}

} // Fechar o bloco if-else de verificação de injeção