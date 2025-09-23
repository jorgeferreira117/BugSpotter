/**
 * AIService - Integração com Google Gemini AI para geração automática de bug reports
 * @author BugSpotter Team
 * @version 1.0.0
 */

class AIService {
    constructor() {
        this.provider = 'gemini';
        this.apiKey = null;
        this.baseUrl = 'https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent';
        this.isEnabled = false;
        this.rateLimiter = {
            requests: 0,
            resetTime: Date.now() + 60000, // Reset a cada minuto
            maxRequests: 10 // Limite mais conservador para evitar 429
        };
        this.retryConfig = {
            maxRetries: 3,
            baseDelay: 1000, // 1 segundo
            maxDelay: 30000  // 30 segundos máximo
        };
    }

    /**
     * Inicializa o serviço AI com configurações do storage
     */
    async initialize() {
        try {
            const settings = await this.getStoredSettings();
            
            // Validar e sanitizar API key
            if (settings.aiApiKey && typeof settings.aiApiKey === 'string') {
                this.apiKey = settings.aiApiKey.trim();
            } else {
                this.apiKey = null;
            }
            
            this.isEnabled = settings.aiEnabled || false;
            this.provider = settings.aiProvider || 'gemini';
            
            // Se AI está habilitada mas não há API key válida, desabilitar
            if (this.isEnabled && (!this.apiKey || this.apiKey === '')) {
                console.warn('[AIService] AI habilitada mas API key não configurada. Desabilitando AI.');
                this.isEnabled = false;
            }
            
            // AIService inicializado - silenciado
        } catch (error) {
            console.error('[AIService] Erro na inicialização:', error);
            this.isEnabled = false;
            this.apiKey = null;
        }
    }

    /**
     * Obtém configurações armazenadas
     */
    async getStoredSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get([
                'aiApiKey',
                'aiEnabled',
                'aiProvider'
            ], (result) => {
                resolve(result);
            });
        });
    }

    /**
     * Verifica se o serviço está configurado
     */
    isConfigured() {
        return this.isEnabled && 
               this.apiKey && 
               typeof this.apiKey === 'string' && 
               this.apiKey.trim() !== '' &&
               this.baseUrl &&
               typeof this.baseUrl === 'string';
    }

    /**
     * Verifica rate limiting
     */
    checkRateLimit() {
        const now = Date.now();
        
        // Reset contador se passou 1 minuto
        if (now > this.rateLimiter.resetTime) {
            this.rateLimiter.requests = 0;
            this.rateLimiter.resetTime = now + 60000;
        }
        
        return this.rateLimiter.requests < this.rateLimiter.maxRequests;
    }

    /**
     * Verifica se devemos pausar temporariamente as requisições AI
     */
    async shouldPauseAI() {
        try {
            // Usar chrome.storage.local em vez de localStorage para compatibilidade com service workers
            const result = await new Promise((resolve) => {
                chrome.storage.local.get(['ai_pause_until'], resolve);
            });
            
            const pauseUntil = result.ai_pause_until;
            
            if (pauseUntil && Date.now() < parseInt(pauseUntil)) {
                return true;
            }
            
            return false;
        } catch (error) {
            console.warn('[AIService] Erro ao verificar pausa da AI:', error);
            return false;
        }
    }

    /**
     * Define pausa temporária para AI após muitos erros 429
     */
    async setPauseAI(minutes = 5) {
        try {
            const pauseUntil = Date.now() + (minutes * 60 * 1000);
            
            // Usar chrome.storage.local em vez de localStorage para compatibilidade com service workers
            await new Promise((resolve) => {
                chrome.storage.local.set({ 'ai_pause_until': pauseUntil.toString() }, resolve);
            });
            
            console.warn(`[AIService] AI pausada por ${minutes} minutos devido a rate limiting`);
        } catch (error) {
            console.error('[AIService] Erro ao definir pausa da AI:', error);
        }
    }

    /**
     * Gera bug report usando AI
     * @param {Object} errorData - Dados do erro HTTP
     * @returns {Promise<Object>} Bug report estruturado
     */
    async generateBugReport(errorData) {
        if (!this.isConfigured()) {
            console.warn('[AIService] Serviço não configurado adequadamente');
            return this.createBasicReport(errorData);
        }

        // Verificar se AI está pausada devido a rate limiting
        if (await this.shouldPauseAI()) {
            console.warn('[AIService] AI pausada devido a rate limiting. Gerando relatório básico.');
            return this.createBasicReport(errorData);
        }

        if (!this.checkRateLimit()) {
            console.warn('[AIService] Rate limit local excedido. Gerando relatório básico.');
            return this.createBasicReport(errorData);
        }

        try {
            this.rateLimiter.requests++;
            
            const prompt = this.buildPrompt(errorData);
            const response = await this.callGeminiAPI(prompt);
            
            // Parse da resposta JSON
            const bugReport = this.parseAIResponse(response);
            
            // Adiciona metadados
            bugReport.metadata = {
                generatedAt: new Date().toISOString(),
                aiProvider: this.provider,
                version: '1.0.0'
            };
            
            // Bug report gerado - silenciado
            return bugReport;
            
        } catch (error) {
            console.error('[AIService] Erro ao gerar bug report:', error);
            
            // Tratamento específico para diferentes tipos de erro
            if (error.message && error.message.includes('API Key não configurada')) {
                console.error('[AIService] API Key inválida ou não configurada');
            } else if (error.message && error.message.includes('Base URL não configurada')) {
                console.error('[AIService] Base URL inválida');
            } else if (error.message && error.message.includes('429')) {
                console.warn('[AIService] Quota da API excedida, pausando AI por 10 minutos');
                await this.setPauseAI(10); // Pausar por 10 minutos
            } else if (error.message && error.message.includes('503')) {
                console.warn('[AIService] Modelo sobrecarregado (503), pausando AI por 15 minutos');
                await this.setPauseAI(15); // Pausar por 15 minutos para sobrecarga
            } else if (error.name === 'TypeError' && error.message.includes('Invalid URL')) {
                console.error('[AIService] Erro de URL inválida - verificar configuração da API');
            } else if (error.message && error.message.includes('quota')) {
                console.warn('[AIService] Quota da API excedida, pausando AI por 5 minutos');
                await this.setPauseAI(5);
            }
            
            // Para outros erros, tentar gerar relatório básico
            console.warn('[AIService] Erro na AI. Gerando relatório básico como fallback.');
            return this.createBasicReport(errorData);
        }
    }

    /**
     * Cria relatório básico sem AI quando há problemas de quota
     * @param {Object} errorData - Dados do erro HTTP
     * @returns {Object} Bug report básico estruturado
     */
    createBasicReport(errorData) {
        // Extrair dados do erro e contexto da estrutura aninhada
        const error = errorData.error || errorData;
        const context = errorData.context || {};
        
        const url = error.url || context.url || 'URL não disponível';
        const status = error.status || context.status || 'Status não disponível';
        const statusText = error.statusText || context.statusText || 'Status text não disponível';
        const responseBody = error.responseBody || context.responseBody || error.responseText || 'Resposta não disponível';
        const method = error.method || context.method || 'GET';
        
        // Tentar extrair informações úteis da resposta
        let errorDetails = '';
        if (typeof responseBody === 'object') {
            errorDetails = JSON.stringify(responseBody, null, 2);
        } else if (typeof responseBody === 'string') {
            errorDetails = responseBody;
        }
        
        return {
            title: `Erro HTTP ${status} - ${method} ${new URL(url).hostname}`,
            description: `Foi detectado um erro HTTP ${status} (${statusText}) na requisição ${method} para ${url}.`,
            severity: status >= 500 ? 'High' : status >= 400 ? 'Medium' : 'Low',
            priority: status >= 500 ? 'High' : 'Medium',
            category: 'Network Error',
            steps: [
                '1. Acessar a página onde o erro ocorreu',
                '2. Executar a ação que causou a requisição HTTP',
                '3. Observar o erro na rede/console'
            ],
            expectedBehavior: 'A requisição deveria ser processada com sucesso',
            actualBehavior: `Erro HTTP ${status}: ${statusText}`,
            technicalDetails: {
                url: url,
                method: method,
                httpStatus: status,
                statusText: statusText,
                responseBody: errorDetails,
                timestamp: error.timestamp || context.timestamp || new Date().toISOString(),
                userAgent: error.userAgent || context.userAgent || navigator.userAgent
            },
            metadata: {
                generatedAt: new Date().toISOString(),
                aiProvider: 'basic-fallback',
                version: '1.0.0',
                note: 'Relatório gerado sem AI devido a limitações de quota'
            }
        };
    }

    /**
     * Constrói o prompt para a AI
     */
    buildPrompt(errorData) {
        // Extrair dados do erro e contexto da estrutura aninhada
        const error = errorData.error || errorData;
        const context = errorData.context || {};
        
        // Sanitiza dados para evitar undefined no JSON
        const sanitizedData = {
            url: error.url || context.url || 'Unknown',
            method: error.method || context.method || 'GET',
            status: error.status || context.status || 'Unknown',
            statusText: error.statusText || context.statusText || 'Unknown',
            timestamp: error.timestamp || context.timestamp || new Date().toISOString(),
            headers: error.headers || context.headers || {},
            responseBody: error.responseBody || context.responseBody || 'N/A',
            userAgent: error.userAgent || context.userAgent || 'N/A',
            referrer: error.referrer || context.referrer || 'N/A',
            consoleLogs: context.consoleLogs || [],
            networkRequests: context.networkRequests || [],
            jsErrors: context.jsErrors || []
        };

        const prompt = `Você é um especialista em debugging web. Analise este erro HTTP e gere um bug report estruturado em português.

**DADOS DO ERRO:**
- URL: ${sanitizedData.url}
- Método HTTP: ${sanitizedData.method}
- Status Code: ${sanitizedData.status}
- Status Text: ${sanitizedData.statusText}
- Timestamp: ${sanitizedData.timestamp}
- Headers: ${JSON.stringify(sanitizedData.headers, null, 2)}
- Response Body: ${sanitizedData.responseBody}
- User Agent: ${sanitizedData.userAgent}
- Referrer: ${sanitizedData.referrer}

**CONTEXTO ADICIONAL:**
- Console Logs: ${JSON.stringify(sanitizedData.consoleLogs, null, 2)}
- Network Requests: ${JSON.stringify(sanitizedData.networkRequests, null, 2)}
- JavaScript Errors: ${JSON.stringify(sanitizedData.jsErrors, null, 2)}

**FORMATO DE RESPOSTA (JSON válido):**
{
  "title": "Título conciso do bug (max 80 chars)",
  "description": "Descrição técnica detalhada em português",
  "priority": "high|medium|low",
  "category": "Network Error|API Error|Server Error|Client Error",
  "steps": [
    "Passo 1 para reproduzir",
    "Passo 2 para reproduzir",
    "Passo 3 para reproduzir"
  ],
  "expectedBehavior": "O que deveria acontecer",
  "actualBehavior": "O que realmente aconteceu",
  "technicalDetails": {
    "errorType": "HTTP Error",
    "statusCode": "${sanitizedData.status}",
    "endpoint": "${sanitizedData.url}",
    "method": "${sanitizedData.method}"
  },
  "suggestedFix": "Sugestão de correção em português",
  "impact": "Impacto no usuário/sistema"
}

**INSTRUÇÕES:**
1. Seja conciso mas informativo
2. Use linguagem técnica apropriada em português
3. Priorize com base na severidade do erro (4xx = medium, 5xx = high)
4. Inclua detalhes suficientes para reprodução
5. Responda APENAS com o JSON válido, sem markdown ou texto adicional
6. NUNCA use valores 'undefined' no JSON - sempre use strings ou números válidos`;

        return prompt;
    }

    /**
     * Chama a API do Google Gemini
     */
    async callGeminiAPI(prompt, retryCount = 0) {
        // Validar apiKey antes de construir URL
        if (!this.apiKey || typeof this.apiKey !== 'string' || this.apiKey.trim() === '') {
            throw new Error('API Key não configurada ou inválida');
        }
        
        // Validar baseUrl
        if (!this.baseUrl || typeof this.baseUrl !== 'string') {
            throw new Error('Base URL não configurada');
        }
        
        const url = `${this.baseUrl}?key=${encodeURIComponent(this.apiKey)}`;
        
        const requestBody = {
            contents: [{
                parts: [{
                    text: prompt
                }]
            }],
            generationConfig: {
                temperature: 0.1, // Baixa criatividade para consistência
                topK: 1,
                topP: 1,
                maxOutputTokens: 1000
            },
            safetySettings: [
                {
                    category: "HARM_CATEGORY_HARASSMENT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_HATE_SPEECH",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                }
            ]
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                
                // Se for erro 429 (rate limit) e ainda temos tentativas
                if (response.status === 429 && retryCount < this.retryConfig.maxRetries) {
                    const delay = this.calculateBackoffDelay(retryCount);
                    console.warn(`[AIService] Rate limit atingido. Tentativa ${retryCount + 1}/${this.retryConfig.maxRetries}. Aguardando ${delay}ms...`);
                    
                    // Aguardar antes de tentar novamente
                    await this.sleep(delay);
                    
                    // Reset do rate limiter para dar uma chance
                    this.rateLimiter.requests = Math.max(0, this.rateLimiter.requests - 1);
                    
                    return this.callGeminiAPI(prompt, retryCount + 1);
                }
                
                // Se for erro 503 (overloaded) e ainda temos tentativas
                if (response.status === 503 && retryCount < this.retryConfig.maxRetries) {
                    const delay = this.calculateBackoffDelay(retryCount) * 2; // Delay maior para sobrecarga
                    console.warn(`[AIService] Modelo sobrecarregado (503). Tentativa ${retryCount + 1}/${this.retryConfig.maxRetries}. Aguardando ${delay}ms...`);
                    
                    await this.sleep(delay);
                    return this.callGeminiAPI(prompt, retryCount + 1);
                }
                
                throw new Error(`Gemini API Error: ${response.status} - ${errorData.error?.message || response.statusText}`);
            }

            const data = await response.json();
            
            if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
                throw new Error('Resposta inválida da API Gemini');
            }

            return data.candidates[0].content.parts[0].text;
            
        } catch (error) {
            // Se for erro de rede e ainda temos tentativas
            if (retryCount < this.retryConfig.maxRetries && 
                (error.name === 'TypeError' || error.message.includes('fetch'))) {
                const delay = this.calculateBackoffDelay(retryCount);
                console.warn(`[AIService] Erro de rede. Tentativa ${retryCount + 1}/${this.retryConfig.maxRetries}. Aguardando ${delay}ms...`);
                
                await this.sleep(delay);
                return this.callGeminiAPI(prompt, retryCount + 1);
            }
            
            throw error;
        }
    }

    /**
     * Calcula delay para backoff exponencial
     */
    calculateBackoffDelay(retryCount) {
        const delay = this.retryConfig.baseDelay * Math.pow(2, retryCount);
        return Math.min(delay, this.retryConfig.maxDelay);
    }

    /**
     * Função sleep para aguardar
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Parse da resposta da AI
     */
    parseAIResponse(response) {
        try {
            // Remove possível markdown ou texto extra
            let cleanResponse = response.trim();
            
            // Remove markdown code blocks (```json ... ```)
            cleanResponse = cleanResponse.replace(/```json\s*([\s\S]*?)\s*```/g, '$1');
            cleanResponse = cleanResponse.replace(/```([\s\S]*?)```/g, '$1');
            
            // Remove texto antes e depois do JSON
            cleanResponse = cleanResponse.trim();
            
            // Procura por JSON válido na resposta
            const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                cleanResponse = jsonMatch[0];
            }
            
            // Remove possíveis caracteres inválidos no início e fim
            cleanResponse = cleanResponse.replace(/^[^{]*/, '');
            cleanResponse = cleanResponse.replace(/[^}]*$/, '');
            
            // Sanitiza valores undefined no JSON antes do parsing
            cleanResponse = this.sanitizeJsonString(cleanResponse);
            
            // JSON limpo para parsing - silenciado
            
            const parsed = JSON.parse(cleanResponse);
            
            // Sanitiza o objeto parseado
            const sanitizedParsed = this.sanitizeParsedObject(parsed);
            
            // Validação básica da estrutura
            if (!sanitizedParsed.title || !sanitizedParsed.description) {
                throw new Error('Estrutura de bug report inválida');
            }
            
            return sanitizedParsed;
            
        } catch (error) {
            console.error('[AIService] Erro ao fazer parse da resposta:', error);
            console.error('[AIService] Resposta original:', response);
            
            // Fallback: bug report básico
            return this.createFallbackReport(response);
        }
    }

    /**
     * Sanitiza string JSON removendo valores undefined
     */
    sanitizeJsonString(jsonString) {
        // Remove valores undefined do JSON
        return jsonString
            .replace(/:\s*undefined/g, ': "Unknown"')
            .replace(/"undefined"/g, '"Unknown"')
            .replace(/,\s*undefined/g, ', "Unknown"')
            .replace(/undefined,/g, '"Unknown",');
    }

    /**
     * Sanitiza objeto parseado recursivamente
     */
    sanitizeParsedObject(obj) {
        if (obj === null || obj === undefined) {
            return 'Unknown';
        }
        
        if (Array.isArray(obj)) {
            return obj.map(item => this.sanitizeParsedObject(item));
        }
        
        if (typeof obj === 'object') {
            const sanitized = {};
            for (const [key, value] of Object.entries(obj)) {
                sanitized[key] = this.sanitizeParsedObject(value);
            }
            return sanitized;
        }
        
        // Para valores primitivos undefined
        if (obj === undefined) {
            return 'Unknown';
        }
        
        return obj;
    }

    /**
     * Cria um bug report básico como fallback
     */
    createFallbackReport(originalResponse) {
        return {
            title: "Erro HTTP Detectado",
            description: "Um erro HTTP foi detectado automaticamente pelo BugSpotter. A AI não conseguiu processar completamente os dados.",
            priority: "medium",
            category: "Network Error",
            steps: [
                "Navegar para a página onde o erro ocorreu",
                "Reproduzir a ação que causou o erro",
                "Verificar console do navegador"
            ],
            expectedBehavior: "Requisição deveria ser processada com sucesso",
            actualBehavior: "Requisição falhou com erro HTTP",
            technicalDetails: {
                errorType: "HTTP Error",
                statusCode: "Unknown",
                endpoint: "Unknown",
                method: "Unknown"
            },
            suggestedFix: "Verificar logs do servidor e conectividade de rede",
            impact: "Funcionalidade pode estar indisponível para usuários",
            aiResponse: originalResponse // Preserva resposta original para debug
        };
    }

    /**
     * Testa a conexão com a API
     */
    async testConnection() {
        if (!this.apiKey) {
            throw new Error('API Key não configurada');
        }

        try {
            const testPrompt = "Responda apenas com: {\"status\": \"ok\", \"message\": \"Conexão funcionando\"}";
            const response = await this.callGeminiAPI(testPrompt);
            
            // Teste de conexão bem-sucedido - silenciado
            return { success: true, message: 'Conexão com Gemini AI estabelecida' };
            
        } catch (error) {
            console.error('[AIService] Teste de conexão falhou:', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Atualiza configurações
     */
    async updateSettings(settings) {
        if (settings.aiApiKey !== undefined) {
            this.apiKey = settings.aiApiKey;
        }
        if (settings.aiEnabled !== undefined) {
            this.isEnabled = settings.aiEnabled;
        }
        if (settings.aiProvider !== undefined) {
            this.provider = settings.aiProvider;
        }
        
        // Configurações atualizadas - silenciado
    }
}

// Export para uso em outros módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AIService;
} else if (typeof window !== 'undefined') {
    window.AIService = AIService;
}