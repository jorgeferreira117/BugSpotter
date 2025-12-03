/**
 * AIService - Integração com Google Gemini AI para geração automática de bug reports
 * @author BugSpotter Team
 * @version 1.0.0
 */

class AIService {
    constructor() {
        this.provider = 'gemini';
        this.apiKey = null;
        this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
        this.model = 'gemini-2.0-flash';
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
                console.warn('[AIService] AI enabled but API key not configured. Disabling AI.');
                this.isEnabled = false;
            }
            
            // AIService inicializado - silenciado
        } catch (error) {
            console.error('[AIService] Initialization error:', error);
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
               typeof this.baseUrl === 'string' &&
               this.model &&
               typeof this.model === 'string';
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
            console.warn('[AIService] Error checking AI pause:', error);
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
            console.error('[AIService] Error setting AI pause:', error);
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
     * Aprimora campos do bug report usando interações do usuário e contexto
     * @param {Object} payload - { fields: {title, description, steps}, interactions: Array, context: Object }
     * @returns {Promise<Object>} Sugestões de aprimoramento { title, description, stepsToReproduce }
     */
    async enhanceBugFields(payload) {
        if (!this.isConfigured()) {
            return {
                title: payload?.fields?.title || '',
                description: payload?.fields?.description || '',
                stepsToReproduce: Array.isArray(payload?.fields?.steps) ? payload.fields.steps : [],
                expectedBehavior: payload?.fields?.expectedBehavior || '',
                actualBehavior: payload?.fields?.actualBehavior || '',
                severity: 'medium'
            };
        }

        if (await this.shouldPauseAI() || !this.checkRateLimit()) {
            return {
                title: payload?.fields?.title || '',
                description: payload?.fields?.description || '',
                stepsToReproduce: Array.isArray(payload?.fields?.steps) ? payload.fields.steps : [],
                expectedBehavior: payload?.fields?.expectedBehavior || '',
                actualBehavior: payload?.fields?.actualBehavior || '',
                severity: 'medium'
            };
        }

        try {
            this.rateLimiter.requests++;
            const prompt = this.buildEnhancementPrompt(payload);
            const response = await this.callGeminiAPI(prompt);
            const parsed = this.parseAIResponse(response);
            // Normalize steps field from possible variants
            let stepsNormalized = [];
            if (Array.isArray(parsed.stepsToReproduce)) {
                stepsNormalized = parsed.stepsToReproduce;
            } else if (Array.isArray(parsed.steps)) {
                stepsNormalized = parsed.steps;
            } else if (Array.isArray(parsed.steps_to_reproduce)) {
                stepsNormalized = parsed.steps_to_reproduce;
            } else if (typeof parsed.stepsToReproduce === 'string') {
                stepsNormalized = parsed.stepsToReproduce.split('\n').map(s => s.trim()).filter(Boolean);
            } else if (typeof parsed.steps === 'string') {
                stepsNormalized = parsed.steps.split('\n').map(s => s.trim()).filter(Boolean);
            } else if (typeof parsed.steps_to_reproduce === 'string') {
                stepsNormalized = parsed.steps_to_reproduce.split('\n').map(s => s.trim()).filter(Boolean);
            }
            // Deterministic fallback: derive steps across pages if AI returned none
            if ((!stepsNormalized || stepsNormalized.length === 0) && Array.isArray(payload?.interactions) && payload.interactions.length) {
                // Work with the last 150 interactions passed from background (already limited)
                const interactions = payload.interactions.slice();
                // Sort by timestamp ascending to preserve sequence
                interactions.sort((a, b) => {
                    const ta = Number(a.timestamp || a.ts || 0);
                    const tb = Number(b.timestamp || b.ts || 0);
                    return ta - tb;
                });

                const steps = [];
                let lastUrl = null;
                let stepIndex = 1;
                const toTitleCase = (s) => (s || '').charAt(0).toUpperCase() + (s || '').slice(1);

                interactions.forEach((it) => {
                    const url = it.url || it.pageUrl || '';
                    const type = (it.type || it.kind || '').toLowerCase();
                    const selector = it.selector || it.path || it.id || it.tag || 'element';
                    const value = it.value || it.text || '';

                    if (type === 'navigate') {
                        if (url && url !== lastUrl) {
                            steps.push(`${stepIndex++}. Navigate to ${url}`);
                            lastUrl = url;
                        } else if (url && !lastUrl) {
                            steps.push(`${stepIndex++}. Navigate to ${url}`);
                            lastUrl = url;
                        }
                        return; // não gerar linha genérica para navigate
                    }

                    // Inserir marcador de navegação quando URL muda entre interações não-navegação
                    if (url && url !== lastUrl) {
                        steps.push(`${stepIndex++}. Navigate to ${url}`);
                        lastUrl = url;
                    }

                    if (type === 'click') {
                        const base = `${stepIndex++}. Click on ${selector}`;
                        steps.push(value ? `${base} (${value})` : base);
                    } else if (type === 'input' || type === 'change') {
                        const base = `${stepIndex++}. Enter value in ${selector}`;
                        steps.push(value ? `${base} (${value})` : base);
                    } else if (type === 'submit') {
                        steps.push(`${stepIndex++}. Submit form ${selector}`);
                    } else if (type) {
                        steps.push(`${stepIndex++}. ${toTitleCase(type)} on ${selector}`);
                    }
                });
                stepsNormalized = steps;
            }
            // Cap steps to 20 for readability in UI
            if (stepsNormalized.length > 20) {
                stepsNormalized = stepsNormalized.slice(0, 20);
            }
            return {
                title: parsed.title || payload?.fields?.title || '',
                description: parsed.description || payload?.fields?.description || '',
                stepsToReproduce: stepsNormalized.length ? stepsNormalized : (Array.isArray(payload?.fields?.steps) ? payload.fields.steps : []),
                expectedBehavior: parsed.expectedBehavior || payload?.fields?.expectedBehavior || '',
                actualBehavior: parsed.actualBehavior || payload?.fields?.actualBehavior || '',
                severity: (parsed.severity || 'medium').toString().toLowerCase()
            };
        } catch (error) {
            return {
                title: payload?.fields?.title || '',
                description: payload?.fields?.description || '',
                stepsToReproduce: Array.isArray(payload?.fields?.steps) ? payload.fields.steps : [],
                expectedBehavior: payload?.fields?.expectedBehavior || '',
                actualBehavior: payload?.fields?.actualBehavior || '',
                severity: 'medium'
            };
        }
    }

    /**
     * Constrói prompt para aprimorar campos com base em interações
     */
    buildEnhancementPrompt(payload) {
        const fields = payload?.fields || {};
        const interactions = Array.isArray(payload?.interactions) ? payload.interactions : [];
        const context = payload?.context || {};

        const sanitized = {
            existingTitle: fields.title || '',
            existingDescription: fields.description || '',
            existingSteps: Array.isArray(fields.steps) ? fields.steps : [],
            existingExpectedBehavior: fields.expectedBehavior || '',
            existingActualBehavior: fields.actualBehavior || '',
            userInteractions: interactions.map(it => ({
                // Map both content-script and generic keys
                type: it.type || it.kind || 'unknown',
                selector: it.selector || it.path || 'unknown',
                value: it.value || it.text || '',
                timestamp: it.timestamp || it.ts || Date.now(),
                url: it.url || it.pageUrl || context.pageUrl || 'Unknown',
                tag: it.tag || '',
                id: it.id || '',
                classes: it.classes || ''
            })),
            pageUrl: context.pageUrl || context.url || 'Unknown',
            pageTitle: context.pageTitle || 'Unknown'
        };

        const prompt = `You are a QA assistant. Improve the bug report fields in English using the user's recent interactions and current values.

Strict instructions:
- Use only real information present in the provided input. Do not invent data.
- Limit stepsToReproduce to a maximum of 20 items.
- If there is insufficient information, keep the existing values or return empty strings.
 - Provide concise 'expectedBehavior' and 'actualBehavior' based on context. Use empty strings if unknown.
 - Provide a simple severity estimate: one of "low", "medium", "high".

Input JSON:
${JSON.stringify(sanitized, null, 2)}

Output ONLY a valid JSON object with fields:
{
  "title": "Improved concise title",
  "description": "Improved description summarizing impact and context",
  "stepsToReproduce": ["Step 1", "Step 2", "... up to 20"],
  "expectedBehavior": "What should have happened",
  "actualBehavior": "What actually happened",
  "severity": "low|medium|high"
}`;
        return prompt;
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
        
        const url = error.url || context.url || 'URL not available';
        const status = error.status || context.status || 'Status not available';
        const statusText = error.statusText || context.statusText || 'Status text not available';
        const responseBody = error.responseBody || context.responseBody || error.responseText || 'Response not available';
        const method = error.method || context.method || 'GET';
        
        // Tentar extrair informações úteis da resposta
        let errorDetails = '';
        if (typeof responseBody === 'object') {
            errorDetails = JSON.stringify(responseBody, null, 2);
        } else if (typeof responseBody === 'string') {
            errorDetails = responseBody;
        }
        
        return {
            title: `HTTP Error ${status} - ${method} ${new URL(url).hostname}`,
            description: `An HTTP error ${status} (${statusText}) was detected on a ${method} request to ${url}.`,
            category: 'Network Error',
            stepsToReproduce: [
                '1. Navigate to the page where the error occurred',
                '2. Reproduce the action that caused the error',
                '3. Observe the error in network/console'
            ],
            expectedBehavior: 'The request should be processed successfully',
            actualBehavior: `HTTP Error ${status}: ${statusText}`,
            details: {
                url,
                method,
                status,
                statusText,
                responseBody: errorDetails,
                timestamp: error.timestamp || context.timestamp || new Date().toISOString(),
                userAgent: error.userAgent || context.userAgent || navigator.userAgent
            },
            severity: status >= 500 ? 'high' : 'medium',
            errorType: 'HTTP Error',
            note: 'Report generated without AI due to quota limitations'
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
            jsErrors: context.jsErrors || [],
            userInteractions: context.userInteractions || []
        };

        const prompt = `You are a web debugging expert. Analyze this HTTP error and generate a structured bug report in English.

Strict instructions:
- Use only real information present in the provided context. Do not invent data.
- Limit stepsToReproduce to a maximum of 7 items.
- If a field is unknown, use "N/A" or an empty string.

**ERROR CONTEXT (sanitized):**
${JSON.stringify(sanitizedData, null, 2)}

Output ONLY a valid JSON object with fields:
{
  "title": "Short, clear title summarizing the issue",
  "description": "Detailed description of what happened",
  "category": "Network Error|API Error|Server Error|Client Error",
  "stepsToReproduce": ["Step 1", "Step 2", "Step 3"],
  "expectedBehavior": "What should have happened",
  "actualBehavior": "What actually happened",
  "errorType": "HTTP Error",
  "severity": "low|medium|high",
  "details": { "url": "...", "method": "...", "status": "...", "statusText": "...", "responseBody": "...", "probableCause": "short hypothesis based on context" }
            }`;

        return prompt;
    }

    /**
     * Chama a API do Google Gemini
     */
    async callGeminiAPI(prompt, retryCount = 0, modelOverride = null) {
        // Validar apiKey antes de construir URL
        if (!this.apiKey || typeof this.apiKey !== 'string' || this.apiKey.trim() === '') {
            throw new Error('API Key não configurada ou inválida');
        }
        
        // Validar baseUrl
        if (!this.baseUrl || typeof this.baseUrl !== 'string') {
            throw new Error('Base URL não configurada');
        }
        
        const candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash'];
        const modelToUse = modelOverride || this.model || candidateModels[0];
        const url = `${this.baseUrl}/${modelToUse}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
        
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
                maxOutputTokens: 1000,
                responseMimeType: 'application/json'
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
                    
                    return this.callGeminiAPI(prompt, retryCount + 1, modelToUse);
                }
                
                // Se for erro 503 (overloaded) e ainda temos tentativas
                if (response.status === 503 && retryCount < this.retryConfig.maxRetries) {
                    const delay = this.calculateBackoffDelay(retryCount) * 2; // Delay maior para sobrecarga
                    console.warn(`[AIService] Modelo sobrecarregado (503). Tentativa ${retryCount + 1}/${this.retryConfig.maxRetries}. Aguardando ${delay}ms...`);
                    
                    await this.sleep(delay);
                    return this.callGeminiAPI(prompt, retryCount + 1, modelToUse);
                }
                
                // Se for erro 404 (modelo não encontrado ou não suportado), tentar modelos alternativos
                if (response.status === 404) {
                    const allModels = [modelToUse, ...candidateModels.filter(m => m !== modelToUse)];
                    const nextIndex = retryCount + 1;
                    if (nextIndex < allModels.length) {
                        const nextModel = allModels[nextIndex];
                        console.warn(`[AIService] Modelo não encontrado ou não suportado: ${modelToUse}. Tentando alternativo: ${nextModel}`);
                        return this.callGeminiAPI(prompt, retryCount + 1, nextModel);
                    }
                    throw new Error(`Gemini API Error: 404 - Model not found or unsupported: ${modelToUse}`);
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
                return this.callGeminiAPI(prompt, retryCount + 1, modelToUse);
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
            title: "HTTP Error Detected",
            description: "An HTTP error was automatically detected by BugSpotter. The AI could not fully process the data.",
            category: "Network Error",
            stepsToReproduce: [
                "Navigate to the page where the error occurred",
                "Reproduce the action that caused the error",
                "Observe the error in network/console"
            ],
            expectedBehavior: "Request should be processed successfully",
            actualBehavior: "Request failed with an HTTP error",
            errorType: "HTTP Error",
            severity: "medium",
            details: {
                url: 'Unknown',
                method: 'GET',
                status: 'Unknown',
                statusText: 'Unknown',
                rawAIResponse: typeof originalResponse === 'string' ? originalResponse.slice(0, 200) : 'N/A'
            }
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
            const testPrompt = "Respond only with: {\"status\": \"ok\", \"message\": \"Connection working\"}";
            const response = await this.callGeminiAPI(testPrompt);
            
            // Teste de conexão bem-sucedido - silenciado
            return { success: true, message: 'Connection to Gemini AI established' };
            
        } catch (error) {
            console.error('[AIService] Connection test failed:', error);
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
        if (settings.aiModel !== undefined) {
            this.model = settings.aiModel;
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