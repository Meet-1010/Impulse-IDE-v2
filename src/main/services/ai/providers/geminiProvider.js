const { GoogleGenerativeAI } = require('@google/generative-ai');
const BaseProvider = require('./baseProvider');

class GeminiProvider extends BaseProvider {
  static DEFAULT_MODEL = 'gemini-2.5-flash';

  constructor(apiKey, model = null) {
    // Ensure model is never null/undefined - use default if not provided
    const effectiveModel = model || GeminiProvider.DEFAULT_MODEL;
    super(apiKey, effectiveModel);
    this.name = 'gemini';
    
    // Initialize with API key
    // The newer SDK version (0.21+) automatically uses the correct API version
    this.genAI = new GoogleGenerativeAI(this.apiKey);
  }

  getAvailableModels() {
    return [
      // Gemini 2.5 family (2025)
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      // Gemini 2.0 family
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      // Gemini 1.5 family (legacy)
      'gemini-1.5-pro',
      'gemini-1.5-flash',
    ];
  }

  formatTools(tools) {
    // Gemini uses Function Calling format
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: tool.parameters.properties || {},
        required: tool.parameters.required || []
      }
    }));
  }

  async chat(messages, options = {}) {
    const modelName = this.model || GeminiProvider.DEFAULT_MODEL;
    
    try {
      // Build model config
      const modelConfig = { 
        model: modelName,
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.max_tokens ?? 8192,
        }
      };

      // Wire up tools if provided
      if (options.tools && Array.isArray(options.tools) && options.tools.length > 0) {
        modelConfig.tools = [{
          functionDeclarations: this.formatTools(options.tools)
        }];
      }

      // Get the model - newer SDK handles API version automatically
      const model = this.genAI.getGenerativeModel(modelConfig);

      // Convert messages to Gemini format
      const { systemInstruction, contents } = this.convertMessagesToGemini(messages);

      // Generate content
      const result = await model.generateContent({
        contents: contents,
        systemInstruction: systemInstruction || undefined,
      });

      const response = result.response;
      
      // response.text() throws if the response only contains function calls
      let text = '';
      try {
        text = response.text();
      } catch (_) {
        // No text content (function-call-only response)
      }

      return {
        content: text || '',
        toolCalls: this.parseToolCalls(response),
        usage: {
          promptTokens: response.usageMetadata?.promptTokenCount || 0,
          completionTokens: response.usageMetadata?.candidatesTokenCount || 0
        },
        model: modelName
      };
    } catch (error) {
      console.error('Gemini API error:', error);
      
      // Handle specific errors
      if (error.message?.includes('API key')) {
        throw new Error('Invalid Gemini API key. Get one from https://aistudio.google.com/apikey');
      }
      
      if (error.message?.includes('not found') || error.message?.includes('404')) {
        throw new Error(`Model "${modelName}" not available. Try updating @google/generative-ai package or use a different model.`);
      }

      if (error.message?.includes('quota') || error.message?.includes('rate')) {
        throw new Error('API quota exceeded. Please wait and try again.');
      }
      
      throw new Error(`Gemini error: ${error.message}`);
    }
  }

  convertMessagesToGemini(messages) {
    let systemInstruction = null;
    const contents = [];
    
    for (const msg of messages) {
      if (msg.role === 'system') {
        // Gemini 1.5+ supports systemInstruction
        if (msg.content) systemInstruction = msg.content;
        continue;
      }

      if (msg.role === 'tool') {
        // Tool result message -> Gemini functionResponse
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: msg.name || 'unknown',
              response: { result: msg.content || '' }
            }
          }]
        });
        continue;
      }

      if (msg.role === 'assistant') {
        const parts = [];
        // Add text content if present
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        // Add function calls if present
        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            const fn = tc.function || tc;
            parts.push({
              functionCall: {
                name: fn.name,
                args: typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : (fn.arguments || {})
              }
            });
          }
        }
        if (parts.length > 0) {
          contents.push({ role: 'model', parts });
        }
        continue;
      }

      // User messages
      if (msg.content) {
        contents.push({
          role: 'user',
          parts: [{ text: msg.content }]
        });
      }
    }
    
    // Ensure we have at least one user message
    if (contents.length === 0) {
      contents.push({
        role: 'user',
        parts: [{ text: 'Hello' }]
      });
    }
    
    return { systemInstruction, contents };
  }

  parseToolCalls(response) {
    const toolCalls = [];
    
    try {
      const candidates = response.candidates || [];
      for (const candidate of candidates) {
        const content = candidate.content;
        if (content && content.parts) {
          for (const part of content.parts) {
            if (part.functionCall) {
              toolCalls.push({
                id: `gemini-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                name: part.functionCall.name,
                arguments: part.functionCall.args || {}
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('Error parsing tool calls:', error);
    }

    return toolCalls;
  }

  validateApiKey(apiKey) {
    // Gemini API keys typically start with "AI" and are 39 characters
    return super.validateApiKey(apiKey) && apiKey.length >= 30;
  }
}

module.exports = GeminiProvider;
