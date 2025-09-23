// Script para testar a extensão BugSpotter
// Execute este script no console do navegador na página test.html

console.log('🧪 Iniciando teste da extensão BugSpotter...');

// Verificar se o content script foi injetado
if (typeof window.bugSpotterContent !== 'undefined') {
  console.log('✅ Content script detectado!');
  console.log('📊 Logs capturados:', window.bugSpotterContent.consoleLogs.length);
} else {
  console.log('❌ Content script não detectado!');
}

// Verificar se fetch foi interceptado
if (window.fetch.toString().includes('bugSpotter') || window.fetch.name === '') {
  console.log('✅ Fetch API interceptada!');
} else {
  console.log('❌ Fetch API não interceptada!');
}

// Verificar se XMLHttpRequest foi interceptado
const xhr = new XMLHttpRequest();
if (xhr.open.toString().includes('bugSpotter') || xhr.open.name === '') {
  console.log('✅ XMLHttpRequest interceptado!');
} else {
  console.log('❌ XMLHttpRequest não interceptado!');
}

// Testar captura de erro HTTP
async function testErrorCapture() {
  console.log('🔄 Testando captura de erro HTTP...');
  
  try {
    await fetch('/nonexistent-endpoint');
  } catch (error) {
    console.log('📝 Erro capturado:', error.message);
  }
  
  // Aguardar um pouco e verificar logs
  setTimeout(() => {
    if (window.bugSpotterContent) {
      const errorLogs = window.bugSpotterContent.consoleLogs.filter(log => 
        log.level === 'error' && log.args[0].includes('HTTP')
      );
      console.log('📊 Erros HTTP capturados:', errorLogs.length);
      if (errorLogs.length > 0) {
        console.log('✅ Último erro HTTP:', errorLogs[errorLogs.length - 1]);
      }
    }
  }, 1000);
}

// Executar teste
testErrorCapture();

console.log('🏁 Teste concluído! Verifique os resultados acima.');