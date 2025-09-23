// Script de teste para verificar se o StorageManager foi corrigido
console.log('=== Teste StorageManager Fix ===');

// Verificar se StorageManager está disponível
if (typeof StorageManager !== 'undefined') {
  console.log('✅ StorageManager class está disponível');
  
  try {
    // Tentar criar uma instância
    const testStorage = new StorageManager();
    console.log('✅ StorageManager instanciado com sucesso');
    
    // Testar métodos básicos
    console.log('✅ Métodos disponíveis:', Object.getOwnPropertyNames(StorageManager.prototype));
    
  } catch (error) {
    console.error('❌ Erro ao instanciar StorageManager:', error);
  }
} else {
  console.error('❌ StorageManager não está disponível');
}

// Verificar se window.storageManager foi criado
if (typeof window !== 'undefined' && window.storageManager) {
  console.log('✅ window.storageManager está disponível');
} else {
  console.log('ℹ️ window.storageManager não foi criado ainda');
}

// Verificar se BugSpotterContent foi inicializado
if (typeof window !== 'undefined' && window.bugSpotterContent) {
  console.log('✅ BugSpotterContent inicializado');
} else {
  console.log('ℹ️ BugSpotterContent não foi inicializado ainda');
}

console.log('=== Fim do teste ===');