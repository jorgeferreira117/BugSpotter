// 🐛 Debug Badge Counter - Script para Console do Popup
// Cole este código no console do DevTools quando o popup da extensão estiver aberto

console.log('🚀 Iniciando debug do badge counter...');

// Função para log formatado
function debugLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const emoji = {
        'info': 'ℹ️',
        'success': '✅',
        'warning': '⚠️',
        'error': '❌'
    };
    console.log(`[${timestamp}] ${emoji[type]} ${message}`);
}

// 1. Verificar status atual do badge
async function checkBadgeStatus() {
    try {
        debugLog('Verificando status do badge...');
        
        // Verificar contador no storage
        const result = await chrome.storage.local.get(['unreadAIReports']);
        const count = result.unreadAIReports || 0;
        debugLog(`Contador no storage: ${count}`);
        
        // Verificar badge atual
        try {
            const badgeText = await chrome.action.getBadgeText({});
            debugLog(`Badge atual: "${badgeText}"`);
        } catch (e) {
            debugLog(`Erro ao verificar badge: ${e.message}`, 'warning');
        }
        
        // Verificar relatórios AI no storage
        const aiReports = await chrome.storage.local.get(['aiReports']);
        const reports = aiReports.aiReports || [];
        debugLog(`Total de relatórios AI: ${reports.length}`);
        
        return { count, reports: reports.length };
        
    } catch (error) {
        debugLog(`Erro ao verificar status: ${error.message}`, 'error');
    }
}

// 2. Resetar contador
async function resetCounter() {
    try {
        debugLog('Resetando contador do badge...');
        
        // Limpar contador
        await chrome.storage.local.set({ unreadAIReports: 0 });
        debugLog('Contador zerado no storage', 'success');
        
        // Limpar badge
        try {
            await chrome.action.setBadgeText({ text: '' });
            debugLog('Badge limpo', 'success');
        } catch (e) {
            debugLog(`Erro ao limpar badge: ${e.message}`, 'warning');
        }
        
        // Verificar se foi realmente resetado
        setTimeout(checkBadgeStatus, 500);
        
    } catch (error) {
        debugLog(`Erro ao resetar contador: ${error.message}`, 'error');
    }
}

// 3. Simular abertura do popup
async function simulatePopupOpen() {
    try {
        debugLog('Simulando abertura do popup...');
        
        const response = await chrome.runtime.sendMessage({ action: 'POPUP_OPENED' });
        debugLog('Mensagem POPUP_OPENED enviada', 'success');
        
        // Verificar resultado
        setTimeout(checkBadgeStatus, 1000);
        
    } catch (error) {
        debugLog(`Erro ao simular popup: ${error.message}`, 'error');
    }
}

// 4. Listar relatórios AI
async function listAIReports() {
    try {
        debugLog('Listando relatórios AI...');
        
        const result = await chrome.storage.local.get(['aiReports']);
        const reports = result.aiReports || [];
        
        debugLog(`Total de relatórios: ${reports.length}`);
        
        if (reports.length > 0) {
            reports.forEach((report, index) => {
                const date = new Date(report.timestamp).toLocaleString();
                debugLog(`${index + 1}. ${report.error?.message || 'Sem mensagem'} - ${date}`);
            });
        } else {
            debugLog('Nenhum relatório AI encontrado');
        }
        
        return reports;
        
    } catch (error) {
        debugLog(`Erro ao listar relatórios: ${error.message}`, 'error');
    }
}

// 5. Testar deduplicação
async function testDeduplication() {
    try {
        debugLog('Testando sistema de deduplicação...');
        
        // Verificar nova chave de persistência
        const result = await chrome.storage.local.get(['processedAIErrors', 'processedErrors']);
        const processedAIErrors = result.processedAIErrors || {};
        const processedErrors = result.processedErrors || []; // Chave antiga
        
        debugLog(`Erros AI processados (nova chave): ${Object.keys(processedAIErrors).length}`);
        debugLog(`Erros processados (chave antiga): ${processedErrors.length}`);
        
        // Mostrar alguns exemplos da nova chave
        const aiEntries = Object.entries(processedAIErrors).slice(0, 5);
        if (aiEntries.length > 0) {
            debugLog('Exemplos de erros AI processados:');
            aiEntries.forEach(([hash, timestamp]) => {
                const date = new Date(timestamp).toLocaleString();
                const age = Math.round((Date.now() - timestamp) / (1000 * 60)); // minutos
                debugLog(`${hash.substring(0, 12)}... (${date}, ${age}min atrás)`);
            });
        }
        
        // Verificar TTL (24 horas)
        const now = Date.now();
        const ttl = 24 * 60 * 60 * 1000;
        const expiredCount = Object.values(processedAIErrors).filter(timestamp => now - timestamp > ttl).length;
        
        debugLog(`Erros expirados (>24h): ${expiredCount}`, 'warning');
        
        return { processedAIErrors, processedErrors };
        
    } catch (error) {
        debugLog(`Erro ao testar deduplicação: ${error.message}`, 'error');
    }
}

// 6. Diagnóstico completo
async function fullDiagnosis() {
    debugLog('=== DIAGNÓSTICO COMPLETO DO BADGE ===');
    
    const status = await checkBadgeStatus();
    await listAIReports();
    await testDeduplication();
    
    debugLog('=== RESUMO ===');
    debugLog(`Contador: ${status?.count || 0}`);
    debugLog(`Relatórios: ${status?.reports || 0}`);
    
    if (status?.count !== status?.reports) {
        debugLog('⚠️ INCONSISTÊNCIA: Contador não bate com número de relatórios!', 'warning');
    } else {
        debugLog('✅ Contador consistente com relatórios', 'success');
    }
}

// Expor funções globalmente para uso no console
window.debugBadge = {
    check: checkBadgeStatus,
    reset: resetCounter,
    popup: simulatePopupOpen,
    list: listAIReports,
    dedup: testDeduplication,
    full: fullDiagnosis
};

// Função adicional para testar nova persistência
window.testDeduplication = async function() {
    console.log('🧪 Testando sistema de deduplicação...');
    
    try {
        // Verificar nova chave de persistência
        const result = await chrome.storage.local.get(['processedAIErrors', 'processedErrors']);
        const processedAIErrors = result.processedAIErrors || {};
        const processedErrors = result.processedErrors || {}; // Chave antiga
        
        console.log('📊 Erros AI processados (nova chave):', Object.keys(processedAIErrors).length);
        console.log('📊 Erros processados (chave antiga):', Object.keys(processedErrors).length);
        
        // Mostrar alguns exemplos da nova chave
        const aiEntries = Object.entries(processedAIErrors).slice(0, 5);
        if (aiEntries.length > 0) {
            console.log('🆕 Exemplos de erros AI processados:');
            aiEntries.forEach(([hash, timestamp]) => {
                const date = new Date(timestamp).toLocaleString();
                const age = Math.round((Date.now() - timestamp) / (1000 * 60)); // minutos
                console.log(`  - ${hash.substring(0, 12)}... (${date}, ${age}min atrás)`);
            });
        }
        
        // Verificar TTL (24 horas)
        const now = Date.now();
        const ttl = 24 * 60 * 60 * 1000;
        const expiredCount = Object.values(processedAIErrors).filter(timestamp => now - timestamp > ttl).length;
        
        console.log(`⏰ Erros expirados (>24h): ${expiredCount}`);
        
        return { processedAIErrors, processedErrors };
    } catch (error) {
        console.error('❌ Erro ao testar deduplicação:', error);
    }
};

debugLog('🎯 Funções disponíveis:', 'success');
debugLog('- debugBadge.check() - Verificar status');
debugLog('- debugBadge.reset() - Resetar contador');
debugLog('- debugBadge.popup() - Simular abertura do popup');
debugLog('- debugBadge.list() - Listar relatórios AI');
debugLog('- debugBadge.dedup() - Testar deduplicação');
debugLog('- testDeduplication() - Testar nova persistência');
debugLog('- debugBadge.full() - Diagnóstico completo');

debugLog('💡 Execute debugBadge.full() para diagnóstico completo', 'info');