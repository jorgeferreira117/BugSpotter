// Script para debug e reset manual do badge
// Execute no console do popup da extensão

console.log('=== DEBUG BADGE RESET MANUAL ===');

// Função para verificar estado atual
async function checkBadgeState() {
  try {
    console.log('1. Verificando estado atual do badge...');
    
    // Verificar storage local
    const storage = await chrome.storage.local.get(['unreadAIReports']);
    console.log('Storage unreadAIReports:', storage.unreadAIReports);
    
    // Verificar badge atual
    const badgeText = await chrome.action.getBadgeText({});
    console.log('Badge text atual:', badgeText);
    
    return {
      storageCount: storage.unreadAIReports || 0,
      badgeText: badgeText
    };
  } catch (error) {
    console.error('Erro ao verificar estado:', error);
    return null;
  }
}

// Função para reset manual
async function resetBadgeManually() {
  try {
    console.log('2. Executando reset manual...');
    
    // Limpar storage
    await chrome.storage.local.set({ unreadAIReports: 0 });
    console.log('✓ Storage limpo');
    
    // Limpar badge
    await chrome.action.setBadgeText({ text: '' });
    console.log('✓ Badge limpo');
    
    // Verificar se funcionou
    const newState = await checkBadgeState();
    console.log('Estado após reset:', newState);
    
    return newState;
  } catch (error) {
    console.error('Erro no reset manual:', error);
    return null;
  }
}

// Função para testar comunicação com background
async function testBackgroundCommunication() {
  try {
    console.log('3. Testando comunicação com background...');
    
    // Testar mensagem POPUP_OPENED
    const response1 = await chrome.runtime.sendMessage({ action: 'POPUP_OPENED' });
    console.log('Resposta POPUP_OPENED:', response1);
    
    // Testar mensagem UPDATE_BADGE
    const response2 = await chrome.runtime.sendMessage({ action: 'UPDATE_BADGE' });
    console.log('Resposta UPDATE_BADGE:', response2);
    
    return { popup_opened: response1, update_badge: response2 };
  } catch (error) {
    console.error('Erro na comunicação:', error);
    return null;
  }
}

// Executar debug completo
async function runFullDebug() {
  console.log('=== INICIANDO DEBUG COMPLETO ===');
  
  const initialState = await checkBadgeState();
  console.log('Estado inicial:', initialState);
  
  const resetResult = await resetBadgeManually();
  console.log('Resultado do reset:', resetResult);
  
  const commTest = await testBackgroundCommunication();
  console.log('Teste de comunicação:', commTest);
  
  const finalState = await checkBadgeState();
  console.log('Estado final:', finalState);
  
  console.log('=== DEBUG COMPLETO FINALIZADO ===');
  
  return {
    initial: initialState,
    reset: resetResult,
    communication: commTest,
    final: finalState
  };
}

// Executar automaticamente
runFullDebug().then(result => {
  console.log('RESULTADO FINAL DO DEBUG:', result);
}).catch(error => {
  console.error('ERRO NO DEBUG:', error);
});

// Disponibilizar funções globalmente para uso manual
window.debugBadge = {
  checkState: checkBadgeState,
  reset: resetBadgeManually,
  testComm: testBackgroundCommunication,
  fullDebug: runFullDebug
};

console.log('Funções disponíveis: window.debugBadge.checkState(), .reset(), .testComm(), .fullDebug()');