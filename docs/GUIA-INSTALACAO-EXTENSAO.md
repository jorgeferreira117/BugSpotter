# 🔧 Guia de Instalação da Extensão BugSpotter

## Problema Identificado

Você está vendo a mensagem "BugSpotter started debugging this browser" no Chrome, mas os testes não detectam a extensão. Isso indica que:

- ✅ A extensão está **parcialmente** carregada (por isso aparece a mensagem)
- ❌ Os **content scripts** não estão sendo injetados corretamente
- ❌ As **instâncias** dos componentes não estão sendo criadas

## Solução Passo-a-Passo

### 1. Verificar Instalação da Extensão

1. **Abra o Chrome** e vá para `chrome://extensions/`
2. **Ative o "Modo do desenvolvedor"** (toggle no canto superior direito)
3. **Localize a extensão BugSpotter** na lista
4. **Verifique se está ativada** (toggle azul)

### 2. Recarregar a Extensão

1. Na página `chrome://extensions/`
2. **Clique no botão "Recarregar"** (🔄) da extensão BugSpotter
3. **Aguarde** alguns segundos para o carregamento completo
4. **Verifique se há erros** na extensão (texto vermelho)

### 3. Verificar Permissões

1. **Clique em "Detalhes"** da extensão BugSpotter
2. **Verifique as permissões** concedidas:
   - ✅ Ler e alterar dados em sites
   - ✅ Armazenamento
   - ✅ Abas
   - ✅ Captura de tela

### 4. Testar a Extensão

1. **Recarregue** a página de teste: http://localhost:8080/debug-extensao.html
2. **Aguarde** 3-5 segundos para os scripts carregarem
3. **Clique em "Executar Debug"** se não executar automaticamente
4. **Verifique os resultados** na página

### 5. Verificar Console do Navegador

1. **Pressione F12** para abrir as ferramentas de desenvolvedor
2. **Vá para a aba "Console"**
3. **Procure por mensagens** que começam com `[BugSpotter]`
4. **Verifique se há erros** (texto vermelho)

## Mensagens Esperadas no Console

Se a extensão estiver funcionando corretamente, você deve ver:

```
🔧 [BugSpotter] Content script carregando...
✅ [BugSpotter] StorageManager inicializado
🌟 [BugSpotter] Criando instância global...
✅ [BugSpotter] Instância global criada
```

## Problemas Comuns e Soluções

### ❌ Problema: "StorageManager não disponível"

**Causa:** O arquivo `StorageManager.js` não foi carregado

**Solução:**
1. Verifique se o arquivo existe: `src/modules/StorageManager.js`
2. Recarregue a extensão em `chrome://extensions/`
3. Verifique o `manifest.json` - deve incluir o StorageManager nos content_scripts

### ❌ Problema: "Chrome APIs não disponíveis"

**Causa:** A página não está sendo servida corretamente ou a extensão não tem permissões

**Solução:**
1. Certifique-se de acessar via `http://localhost:8080/`
2. Não use `file://` URLs
3. Verifique as permissões da extensão

### ❌ Problema: "Extension ID não detectado"

**Causa:** A extensão não está carregada ou há erro no manifest

**Solução:**
1. Recarregue a extensão
2. Verifique se há erros no `manifest.json`
3. Reinstale a extensão se necessário

### ❌ Problema: "Classes disponíveis, mas instâncias não criadas"

**Causa:** Erro na inicialização dos scripts

**Solução:**
1. Verifique o console por erros JavaScript
2. Recarregue a página após recarregar a extensão
3. Aguarde mais tempo para o carregamento

## Comandos de Diagnóstico

### No Console do Navegador (F12):

```javascript
// Verificar se as classes estão disponíveis
console.log('StorageManager:', typeof window.StorageManager);
console.log('BugSpotterContent:', typeof window.BugSpotterContent);

// Verificar se as instâncias estão criadas
console.log('storageManager:', typeof window.storageManager);
console.log('bugSpotterContent:', typeof window.bugSpotterContent);

// Verificar Chrome APIs
console.log('chrome:', typeof chrome);
console.log('chrome.runtime:', typeof chrome?.runtime);
console.log('Extension ID:', chrome?.runtime?.id);
```

## Reinstalação Completa (Se Necessário)

1. **Remova a extensão** em `chrome://extensions/`
2. **Feche e reabra o Chrome**
3. **Vá para** `chrome://extensions/`
4. **Ative o "Modo do desenvolvedor"**
5. **Clique "Carregar sem compactação"**
6. **Selecione a pasta** `/Users/jorgeferreira/Documents/bugSpotter_trae`
7. **Aguarde o carregamento** e verifique se não há erros
8. **Teste novamente** a página de debug

## Páginas de Teste Disponíveis

1. **Debug Simples:** http://localhost:8080/debug-extensao.html
2. **Verificação Completa:** http://localhost:8080/verificar-extensao.html
3. **Teste Detalhado:** http://localhost:8080/teste-extensao-detalhado.html

## Próximos Passos

Após seguir este guia:

1. ✅ A extensão deve aparecer como totalmente funcional
2. ✅ Todos os testes devem passar
3. ✅ As instâncias devem ser criadas corretamente
4. ✅ A comunicação com o background deve funcionar

---

**💡 Dica:** Se o problema persistir, verifique se há conflitos com outras extensões desativando-as temporariamente.

**🔍 Debug Avançado:** Use as ferramentas de desenvolvedor do Chrome (F12) para inspecionar a aba "Sources" e verificar se os scripts da extensão estão sendo carregados.