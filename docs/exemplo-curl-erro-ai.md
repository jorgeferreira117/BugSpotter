# 🔧 Exemplos de Curl para Testar Erros HTTP com AI

## Comandos Curl para Gerar Erros que Acionam a AI

### 1. Erro 404 - Recurso Não Encontrado
```bash
curl -X GET "http://localhost:8080/api/recurso-inexistente" \
  -H "Content-Type: application/json" \
  -H "User-Agent: BugSpotter-Test/1.0" \
  -v
```

### 2. Erro 500 - Erro Interno do Servidor
```bash
curl -X POST "http://localhost:8080/api/erro-interno" \
  -H "Content-Type: application/json" \
  -H "User-Agent: BugSpotter-Test/1.0" \
  -d '{
    "action": "trigger_error",
    "error_type": "internal_server_error",
    "timestamp": "2025-01-11T10:30:00Z"
  }' \
  -v
```

### 3. Erro 400 - Requisição Inválida
```bash
curl -X PUT "http://localhost:8080/api/usuario/123" \
  -H "Content-Type: application/json" \
  -H "User-Agent: BugSpotter-Test/1.0" \
  -d '{
    "dados_invalidos": "sem_validacao",
    "campo_obrigatorio": null
  }' \
  -v
```

### 4. Erro 401 - Não Autorizado
```bash
curl -X DELETE "http://localhost:8080/api/admin/usuarios/456" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer token_invalido" \
  -H "User-Agent: BugSpotter-Test/1.0" \
  -v
```

### 5. Erro 503 - Serviço Indisponível (Testa Retry da AI)
```bash
curl -X PATCH "http://localhost:8080/api/servico-sobrecarregado" \
  -H "Content-Type: application/json" \
  -H "User-Agent: BugSpotter-Test/1.0" \
  -d '{
    "operacao": "update_heavy_process",
    "dados": {
      "id": 789,
      "processamento_pesado": true
    }
  }' \
  -v
```

## Parâmetros Importantes do Curl

- `-X METHOD`: Define o método HTTP (GET, POST, PUT, DELETE, PATCH)
- `-H "Header: Value"`: Adiciona cabeçalhos HTTP
- `-d 'data'`: Envia dados no corpo da requisição
- `-v`: Modo verbose (mostra detalhes da requisição/resposta)
- `--max-time 30`: Timeout de 30 segundos
- `--retry 0`: Desabilita retry automático do curl

## Como os Erros São Processados

1. **Captura pelo BugSpotter**: A extensão detecta erros HTTP na aba Network
2. **Coleta de Contexto**: Informações como URL, método, status, headers são coletadas
3. **Processamento AI**: O erro é enviado para a API Gemini para análise
4. **Tratamento de Erro 503**: Se a API estiver sobrecarregada:
   - Retry automático com backoff exponencial (2s, 4s, 8s)
   - Após 3 tentativas, AI é pausada por 15 minutos
   - Fallback para relatório básico

## Testando Diferentes Cenários

### Teste de Método HTTP Específico
```bash
# Testa se o método é capturado corretamente
curl -X OPTIONS "http://localhost:8080/api/cors-test" \
  -H "Origin: https://exemplo.com" \
  -v
```

### Teste com Headers Customizados
```bash
# Testa captura de headers específicos
curl -X POST "http://localhost:8080/api/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Custom-Header: valor-teste" \
  -H "X-Request-ID: req-123456" \
  -d '{
    "evento": "teste_bugspotter",
    "dados": {
      "timestamp": "2025-01-11T10:30:00Z",
      "origem": "curl_test"
    }
  }' \
  -v
```

### Teste de Timeout (Simula Erro de Rede)
```bash
# Força timeout para testar tratamento de erro de rede
curl -X GET "http://localhost:8080/api/lento" \
  --max-time 1 \
  -v
```

## Monitoramento dos Resultados

1. **Console do Navegador**: Verifique logs do BugSpotter
2. **Extensão Popup**: Veja relatórios gerados
3. **Storage da Extensão**: Histórico de erros processados
4. **Logs da AI**: Mensagens sobre retry e tratamento de erro 503

## Exemplo de Resposta Esperada da AI

```json
{
  "title": "Erro HTTP 500 - POST /api/erro-interno",
  "description": "Erro interno do servidor detectado durante requisição POST",
  "severity": "high",
  "technicalDetails": {
    "method": "POST",
    "url": "http://localhost:8080/api/erro-interno",
    "status": 500,
    "statusText": "Internal Server Error",
    "timestamp": "2025-01-11T10:30:00Z",
    "userAgent": "BugSpotter-Test/1.0"
  },
  "possibleCauses": [
    "Erro na lógica do servidor",
    "Problema de conexão com banco de dados",
    "Exceção não tratada no código"
  ],
  "suggestedActions": [
    "Verificar logs do servidor",
    "Validar dados enviados na requisição",
    "Testar conectividade com dependências"
  ]
}
```

---

**Nota**: Estes comandos curl geram erros HTTP que são capturados pelo BugSpotter e processados pela AI. Se a API Gemini retornar erro 503, o sistema implementa retry automático e fallback para relatório básico.