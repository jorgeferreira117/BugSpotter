# 🐛 BugSpotter

Uma extensão Chrome avançada para captura, análise e reporte automatizado de bugs com integração IA e Jira.

## 🌟 Visão Geral

BugSpotter é uma extensão Chrome profissional que revoluciona o processo de identificação e reporte de bugs. Com integração de IA (Google Gemini), captura automática de logs, análise inteligente de erros e integração direta com Jira, ela oferece uma solução completa para equipes de desenvolvimento.

## ✨ Funcionalidades Principais

### 🔍 Detecção Automática
- **Interceptação de Logs**: Captura automática de erros JavaScript, HTTP e console
- **Análise IA**: Classificação inteligente de severidade e sugestões de correção
- **Deduplicação**: Sistema avançado para evitar relatórios duplicados
- **Monitoramento em Tempo Real**: Acompanhamento contínuo de erros

### 📸 Captura de Evidências
- **Screenshots**: Captura automática ou manual de telas
- **Gravação de Vídeo**: Grave interações para demonstrar problemas
- **Logs Contextuais**: Coleta automática de logs relevantes
- **Informações do Sistema**: Dados do navegador, URL, timestamp

### 🔗 Integrações
- **Jira**: Criação automática de tickets com evidências
- **Google Gemini AI**: Análise inteligente e sugestões
- **Storage Local**: Histórico persistente de relatórios
- **Notificações**: Alertas em tempo real

### 🛡️ Segurança
- **Criptografia AES-GCM**: Proteção de dados sensíveis
- **Validação de Entrada**: Sanitização de dados
- **Rate Limiting**: Proteção contra spam
- **Gerenciamento Seguro de Chaves**: Armazenamento criptografado

## 🚀 Instalação

### Pré-requisitos
- Google Chrome 88+
- Node.js 16+ (para desenvolvimento)
- Conta Google (para IA)
- Conta Jira (opcional)

### Instalação Rápida

1. **Clone o repositório**:
   ```bash
   git clone https://github.com/SEU_USERNAME/BugSpotter.git
   cd BugSpotter
   ```

2. **Instale dependências** (apenas para desenvolvimento):
   ```bash
   npm install
   ```

3. **Carregue no Chrome**:
   - Abra `chrome://extensions/`
   - Ative "Modo do desenvolvedor"
   - Clique "Carregar sem compactação"
   - Selecione a pasta do projeto

### Configuração Inicial

1. **Configure a API do Gemini**:
   - Acesse as configurações da extensão
   - Insira sua chave da API do Google Gemini
   - Teste a conexão

2. **Configure Jira** (opcional):
   - Insira URL do servidor Jira
   - Configure credenciais de autenticação
   - Teste a integração

## 📖 Guia de Uso

### Uso Básico

1. **Ativação Automática**:
   - A extensão monitora automaticamente erros
   - Clique no ícone para ver relatórios
   - Badge mostra número de novos erros

2. **Captura Manual**:
   ```javascript
   // Simule um erro para teste
   console.error('Erro de teste para BugSpotter');
   ```

3. **Visualização de Relatórios**:
   - Abra o popup da extensão
   - Navegue pelo histórico
   - Visualize detalhes e evidências

### Exemplos Práticos

#### Exemplo 1: Erro JavaScript
```javascript
// Este erro será automaticamente capturado
function exemploErro() {
    throw new Error('Falha na validação do formulário');
}
exemploErro();
```

#### Exemplo 2: Erro HTTP
```javascript
// Erros de API são interceptados automaticamente
fetch('/api/dados-inexistentes')
    .catch(error => console.error('Erro na API:', error));
```

#### Exemplo 3: Configuração Personalizada
```javascript
// Configure filtros personalizados
chrome.storage.local.set({
    'bugspotter_config': {
        'severity_threshold': 'medium',
        'auto_jira': true,
        'domains': ['app.exemplo.com']
    }
});
```

## ⚙️ Configuração Avançada

### Variáveis de Ambiente
```bash
# .env (para desenvolvimento)
GEMINI_API_KEY=sua_chave_aqui
JIRA_URL=https://sua-empresa.atlassian.net
JIRA_USERNAME=seu_email
JIRA_TOKEN=seu_token
```

### Configurações da Extensão
```json
{
  "ai_analysis": true,
  "auto_screenshot": true,
  "jira_integration": true,
  "severity_filter": "medium",
  "max_reports_per_hour": 10,
  "domains_whitelist": ["*.exemplo.com"]
}
```

## 🧪 Desenvolvimento

### Estrutura do Projeto
```
bugSpotter_trae/
├── src/
│   ├── background/     # Service Worker
│   ├── content/        # Content Scripts
│   ├── modules/        # Módulos principais
│   ├── ui/            # Interface do usuário
│   └── utils/         # Utilitários
├── tests/             # Testes automatizados
├── debug/             # Arquivos de debug
└── docs/              # Documentação
```

### Scripts Disponíveis
```bash
# Executar testes
npm test

# Testes com cobertura
npm run test:coverage

# Testes em modo watch
npm run test:watch

# Build para produção
npm run build
```

### Executar Testes
```bash
# Todos os testes
npm test

# Teste específico
npm test -- --testNamePattern="SecurityManager"

# Com cobertura
npm run test:coverage
```

## 🔧 Troubleshooting

### Problemas Comuns

**Extensão não carrega**:
- Verifique se o modo desenvolvedor está ativo
- Confirme que o manifest.json está válido
- Veja o console de extensões para erros

**IA não funciona**:
- Verifique a chave da API do Gemini
- Confirme conexão com internet
- Veja logs no background script

**Jira não conecta**:
- Teste credenciais manualmente
- Verifique URL e permissões
- Confirme configuração CORS

### Debug
```javascript
// Ativar logs detalhados
chrome.storage.local.set({debug_mode: true});

// Ver logs do background
chrome.runtime.getBackgroundPage(console.log);

// Limpar dados
chrome.storage.local.clear();
```

## 📊 Métricas e Performance

- **Cobertura de Testes**: 85%+ (objetivo: 90%)
- **Performance**: < 50ms para captura de erros
- **Memória**: < 10MB de uso médio
- **Compatibilidade**: Chrome 88+, Edge 88+

## 🤝 Contribuição

### Como Contribuir
1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/nova-funcionalidade`)
3. Commit suas mudanças (`git commit -am 'Adiciona nova funcionalidade'`)
4. Push para a branch (`git push origin feature/nova-funcionalidade`)
5. Abra um Pull Request

### Padrões de Código
- Use ESLint para formatação
- Escreva testes para novas funcionalidades
- Documente APIs públicas
- Siga convenções de commit semântico

## 📄 Licença

Este projeto está licenciado sob a MIT License - veja o arquivo [LICENSE](LICENSE) para detalhes.

## 🆘 Suporte

- **Documentação**: [Wiki do Projeto](https://github.com/SEU_USERNAME/BugSpotter/wiki)
- **Issues**: [GitHub Issues](https://github.com/SEU_USERNAME/BugSpotter/issues)
- **Discussões**: [GitHub Discussions](https://github.com/SEU_USERNAME/BugSpotter/discussions)
- **Email**: suporte@bugspotter.com

## 🎯 Roadmap

- [ ] Integração com Slack/Teams
- [ ] Dashboard web para análise
- [ ] Suporte a outros navegadores
- [ ] API REST para integrações
- [ ] Machine Learning para predição de bugs
- [ ] Integração com ferramentas de CI/CD

---

**Desenvolvido com ❤️ para tornar o debugging mais eficiente**