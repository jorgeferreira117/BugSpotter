# 🚀 Instalação Rápida - BugSpotter Extension

## ❌ PROBLEMA: Extensão não detectada

**Sintomas:**
- `storageManager: false`
- `bugSpotterContent: false`
- Console não mostra logs do BugSpotter

## ✅ SOLUÇÃO PASSO-A-PASSO

### 1. 🌐 Abrir Chrome Extensions
```
Digite na barra de endereços: chrome://extensions/
```

### 2. 🔧 Ativar Modo Desenvolvedor
- Procure o toggle "Modo do desenvolvedor" no canto superior direito
- **CLIQUE para ativar** (deve ficar azul/ativo)

### 3. 📁 Carregar Extensão
- Clique no botão **"Carregar sem compactação"**
- Navegue até a pasta: `/Users/jorgeferreira/Documents/bugSpotter_trae`
- **SELECIONE A PASTA INTEIRA** (não um arquivo específico)
- Clique "Selecionar"

### 4. ✅ Verificar Instalação
- A extensão "BugSpotter" deve aparecer na lista
- **NÃO deve ter ícones de erro (⚠️)**
- Status deve estar "Ativado"

### 5. 🔄 Recarregar se Necessário
- Se houver erros, clique no ícone de **reload (🔄)** da extensão
- Aguarde alguns segundos

### 6. 🌐 Testar
- Abra: `http://localhost:8080/test.html`
- **Recarregue a página** (F5)
- Clique em "🔄 Verificar Extensão Novamente"

## 🔍 LOGS ESPERADOS NO CONSOLE

Quando funcionando, deve aparecer:
```
🔧 [BugSpotter] Content script carregando...
✅ [BugSpotter] StorageManager inicializado
🚀 [BugSpotter] Inicializando BugSpotterContent...
✅ [BugSpotter] Instância global criada
```

## 🚨 SE AINDA NÃO FUNCIONAR

### Verificar Erros
1. Em `chrome://extensions/`
2. Clique em "Detalhes" da extensão BugSpotter
3. Procure por erros na seção "Erros"
4. Se houver erros, anote-os

### Reset Completo
1. **Remover** a extensão (lixeira)
2. **Fechar** Chrome completamente
3. **Reabrir** Chrome
4. **Reinstalar** seguindo os passos acima

### Verificar Arquivos
Certifique-se que estes arquivos existem:
- ✅ `manifest.json`
- ✅ `src/modules/StorageManager.js`
- ✅ `src/content/content.js`
- ✅ `src/background/background.js`

## 💡 DICAS IMPORTANTES

- **Use apenas Chrome** (não Safari, Firefox, Edge)
- **Pasta correta**: Selecione a pasta raiz do projeto
- **Recarregue**: Sempre recarregue a página após instalar
- **DevTools**: Abra F12 para ver os logs
- **Paciência**: Aguarde alguns segundos após instalação

## 🎯 TESTE FINAL

Se tudo estiver correto:
- ✅ `storageManager: true`
- ✅ `bugSpotterContent: true`
- ✅ `chrome: true`
- ✅ Logs do BugSpotter no console

---

**🔗 Links Úteis:**
- Página de teste: `http://localhost:8080/test.html`
- Debug avançado: `http://localhost:8080/test-extension-debug.html`
- Chrome Extensions: `chrome://extensions/`