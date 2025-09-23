// 🔧 Script de Debug e Reset Completo do Badge
// Cole este script no console do popup da extensão (F12)

console.log('🚀 Iniciando debug completo do badge...');

// Função para verificar todo o storage relacionado ao badge
window.debugBadgeComplete = async function() {
    console.log('\n=== 🔍 DIAGNÓSTICO COMPLETO DO BADGE ===');
    
    try {
        // Verificar todas as chaves relacionadas
        const allKeys = [
            'unreadAIReports',
            'aiReports', 
            'processedAIErrors',
            'processedErrors',
            'notifications',
            'bugReports'
        ];
        
        const result = await chrome.storage.local.get(allKeys);
        
        console.log('📊 Estado atual do storage:');
        for (const [key, value] of Object.entries(result)) {
            if (value !== undefined) {
                if (typeof value === 'object') {
                    const count = Array.isArray(value) ? value.length : Object.keys(value).length;
                    console.log(`  ${key}: ${count} itens`);
                } else {
                    console.log(`  ${key}: ${value}`);
                }
            }
        }
        
        // Verificar badge atual
        const badgeText = await chrome.action.getBadgeText({});
        console.log(`\n🏷️ Badge atual: "${badgeText}"`);
        
        // Contar relatórios AI reais
        const aiReports = result.aiReports || [];
        const unreadCount = result.unreadAIReports || 0;
        
        console.log(`\n📈 Análise detalhada:`);
        console.log(`  - Relatórios AI no storage: ${aiReports.length}`);
        console.log(`  - Contador não lidos: ${unreadCount}`);
        console.log(`  - Badge mostrado: ${badgeText}`);
        
        // Verificar inconsistências
        if (badgeText !== unreadCount.toString() && badgeText !== '') {
            console.warn('⚠️ INCONSISTÊNCIA: Badge não corresponde ao contador!');
        }
        
        return result;
        
    } catch (error) {
        console.error('❌ Erro no diagnóstico:', error);
    }
};

// Função para reset completo
window.resetBadgeComplete = async function() {
    console.log('\n=== 🔄 RESET COMPLETO DO BADGE ===');
    
    try {
        // 1. Zerar contador
        await chrome.storage.local.set({ unreadAIReports: 0 });
        console.log('✅ Contador zerado');
        
        // 2. Limpar badge
        await chrome.action.setBadgeText({ text: '' });
        console.log('✅ Badge limpo');
        
        // 3. Enviar mensagem para background script
        await chrome.runtime.sendMessage({ 
            action: 'UPDATE_BADGE',
            force: true 
        });
        console.log('✅ Background script notificado');
        
        // 4. Verificar resultado
        setTimeout(async () => {
            const newBadgeText = await chrome.action.getBadgeText({});
            const newCount = await chrome.storage.local.get(['unreadAIReports']);
            
            console.log('\n🎯 Resultado do reset:');
            console.log(`  - Badge: "${newBadgeText}"`);
            console.log(`  - Contador: ${newCount.unreadAIReports || 0}`);
            
            if (newBadgeText === '' && (newCount.unreadAIReports || 0) === 0) {
                console.log('🎉 RESET CONCLUÍDO COM SUCESSO!');
            } else {
                console.warn('⚠️ Reset pode não ter funcionado completamente');
            }
        }, 1000);
        
    } catch (error) {
        console.error('❌ Erro no reset:', error);
    }
};

// Função para limpar storage antigo
window.cleanOldStorage = async function() {
    console.log('\n=== 🧹 LIMPEZA DE STORAGE ANTIGO ===');
    
    try {
        // Remover chaves antigas que podem estar causando conflito
        const oldKeys = [
            'processedErrors', // Chave antiga de deduplicação
            'badgeCount',      // Possível chave antiga
            'unreadCount'      // Possível chave antiga
        ];
        
        await chrome.storage.local.remove(oldKeys);
        console.log('✅ Chaves antigas removidas:', oldKeys);
        
        // Verificar se ainda existem
        const check = await chrome.storage.local.get(oldKeys);
        const remaining = Object.keys(check).filter(key => check[key] !== undefined);
        
        if (remaining.length === 0) {
            console.log('✅ Limpeza concluída - nenhuma chave antiga encontrada');
        } else {
            console.warn('⚠️ Algumas chaves antigas ainda existem:', remaining);
        }
        
    } catch (error) {
        console.error('❌ Erro na limpeza:', error);
    }
};

// Função para diagnóstico de deduplicação
window.debugDeduplication = async function() {
    console.log('\n=== 🔍 DIAGNÓSTICO DE DEDUPLICAÇÃO ===');
    
    try {
        const result = await chrome.storage.local.get(['processedAIErrors', 'processedErrors']);
        
        const newErrors = result.processedAIErrors || {};
        const oldErrors = result.processedErrors || {};
        
        console.log('📊 Erros processados:');
        console.log(`  - Nova chave (processedAIErrors): ${Object.keys(newErrors).length}`);
        console.log(`  - Chave antiga (processedErrors): ${Array.isArray(oldErrors) ? oldErrors.length : Object.keys(oldErrors).length}`);
        
        // Mostrar alguns exemplos
        if (Object.keys(newErrors).length > 0) {
            console.log('\n🆕 Exemplos de erros processados (nova chave):');
            Object.entries(newErrors).slice(0, 3).forEach(([hash, timestamp]) => {
                const date = new Date(timestamp).toLocaleString();
                const age = Math.round((Date.now() - timestamp) / (1000 * 60));
                console.log(`  ${hash.substring(0, 12)}... (${age}min atrás)`);
            });
        }
        
        return { newErrors, oldErrors };
        
    } catch (error) {
        console.error('❌ Erro no diagnóstico de deduplicação:', error);
    }
};

// Executar diagnóstico inicial
debugBadgeComplete();

console.log('\n🎯 Funções disponíveis:');
console.log('- debugBadgeComplete() - Diagnóstico completo');
console.log('- resetBadgeComplete() - Reset completo do badge');
console.log('- cleanOldStorage() - Limpar storage antigo');
console.log('- debugDeduplication() - Verificar deduplicação');
console.log('\n💡 Recomendação: Execute resetBadgeComplete() para corrigir o problema');