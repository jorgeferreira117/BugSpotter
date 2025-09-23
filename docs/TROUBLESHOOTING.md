# 🔧 Guia de Troubleshooting - BugSpotter Extension

## 🚨 Problema: Extensão não está sendo detectada

### Sintomas
- `storageManager: false`
- `bugSpotterContent: false` 
- `chrome: true`
- Nenhum log do BugSpotter no console

## ✅ Soluções Passo a Passo

### 1. Verificar Instalação da Extensão

1. **Abra o Chrome** (recomendado - outras versões do Chromium podem ter problemas)
2. **Vá para** `chrome://extensions/`
3. **Ative** o "Modo do desenvolvedor" (toggle no canto superior direito)
4. **Clique** em "Carregar sem compactação" ou "Load unpacked"
5. **Selecione** a pasta raiz do projeto BugSpotter (`/Users/jorgeferreira/Documents/bugSpotter_trae`)
6. **Verifique** se a extensão aparece na lista sem erros

### 2. Verificar Erros na Extensão

1. **Em** `chrome://extensions/`
2. **Procure** por ícones de erro (⚠️) na extensão BugSpotter
3. **Clique** em "Detalhes" da extensão
4. **Verifique** a seção "Erros" - deve estar vazia
5. **Se houver erros**, anote-os e corrija os problemas

### 3. Recarregar a Extensão

1. **Em** `chrome://extensions/`
2. **Encontre** a extensão BugSpotter
3. **Clique** no ícone de reload (🔄) da extensão
4. **Aguarde** alguns segundos
5. **Recarregue** a página de teste

### 4. Verificar Permissões

1. **Clique** em "Detalhes" da extensão
2. **Verifique** se as permissões estão ativas:
   - ✅ Ler e alterar todos os seus dados nos sites que você visita
   - ✅ Armazenar dados ilimitados no cliente
   - ✅ Acessar suas guias e atividade de navegação

### 5. Verificar Console do DevTools

1. **Abra** a página de teste (`http://localhost:8080/test-extension-debug.html`)
2. **Pressione** F12 para abrir DevTools
3. **Vá** para a aba "Console"
4. **Procure** por logs do BugSpotter:
   - `🔧 [BugSpotter] Content script carregando...`
   - `✅ [BugSpotter] StorageManager inicializado`
   - `🚀 [BugSpotter] Inicializando BugSpotterContent...`
   - `✅ [BugSpotter] Instância global criada`

### 6. Verificar Arquivos da Extensão

**Certifique-se de que estes arquivos existem:**
- ✅ `manifest.json`
- ✅ `src/modules/StorageManager.js`
- ✅ `src/content/content.js`
- ✅ `src/background/background.js`
- ✅ `src/ui/popup.html`
- ✅ `icon16.png`, `icon48.png`, `icon128.png`

## 🔍 Diagnóstico Avançado

### Verificar Service Worker (Background Script)

1. **Em** `chrome://extensions/`
2. **Clique** em "Detalhes" da extensão
3. **Procure** por "Inspecionar visualizações" → "service worker"
4. **Clique** no link para abrir DevTools do service worker
5. **Verifique** se há erros no console

### Verificar Content Scripts

1. **Na página de teste**, abra DevTools (F12)
2. **Vá** para Sources → Content Scripts
3. **Verifique** se os scripts aparecem:
   - `StorageManager.js`
   - `content.js`

### Logs Esperados no Console

```
🔧 [BugSpotter] Content script carregando... {url: "http://localhost:8080/...", storageManagerAvailable: true, chromeAvailable: true}
✅ [BugSpotter] StorageManager inicializado
🚀 [BugSpotter] Inicializando BugSpotterContent...
🌟 [BugSpotter] Criando instância global...
✅ [BugSpotter] Instância global criada: {bugSpotterContent: true, storageManager: true, BugSpotterContent: true}
```

## 🚨 Problemas Comuns e Soluções

### Problema: "Manifest file is missing or unreadable"
**Solução:** Verifique se o arquivo `manifest.json` existe e tem sintaxe válida

### Problema: "Could not load content script"
**Solução:** Verifique se os arquivos `src/modules/StorageManager.js` e `src/content/content.js` existem

### Problema: "Extension service worker failed to start"
**Solução:** Verifique se o arquivo `src/background/background.js` existe e não tem erros de sintaxe

### Problema: Scripts carregam mas variáveis são `false`
**Solução:** 
1. Recarregue a extensão
2. Limpe o cache do navegador (Ctrl+Shift+R)
3. Feche e reabra o navegador

## 🔄 Processo de Reset Completo

1. **Remova** a extensão do Chrome
2. **Feche** o navegador completamente
3. **Reabra** o Chrome
4. **Reinstale** a extensão seguindo os passos do item 1
5. **Teste** novamente

## 📞 Ainda com Problemas?

1. **Verifique** se está usando Chrome (não Edge, Firefox, etc.)
2. **Teste** em uma janela anônima
3. **Desative** outras extensões temporariamente
4. **Verifique** se o Chrome está atualizado
5. **Teste** em outro computador se possível

## 🎯 Teste Final

Após seguir os passos acima:
1. **Abra** `http://localhost:8080/test-extension-debug.html`
2. **Clique** em "🔍 Verificar Extensão"
3. **Deve mostrar** todos os componentes como ✅
4. **Console deve mostrar** logs do BugSpotter

Se ainda não funcionar, o problema pode ser específico do ambiente ou configuração do Chrome.