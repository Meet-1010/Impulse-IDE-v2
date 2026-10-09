const OpenAI = require('openai');
const BaseProvider = require('./baseProvider');
const { getAllTools } = require('../tools/toolSchema');

class OpenAIProvider extends BaseProvider {
  static DEFAULT_MODEL = 'gpt-4.1-mini';

  constructor(apiKey, model = null) {
    // Ensure model is never null/undefined - use default if not provided
    const effectiveModel = model || OpenAIProvider.DEFAULT_MODEL;
    super(apiKey, effectiveModel);
    this.name = 'openai';
    this.client = new OpenAI({ apiKey: this.apiKey });
  }

  getAvailableModels() {
    return [
      // GPT-4.1 family (April 2025)
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
      // Reasoning models
      'o4-mini',
      'o3-mini',
      // GPT-4o family
      'gpt-4o',
      'gpt-4o-mini',
      // Legacy
      'gpt-4-turbo',
      'gpt-4',
      'gpt-3.5-turbo'
    ];
  }

  formatTools(tools) {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }

  async chat(messages, options = {}) {
    const tools = options.tools !== undefined ? options.tools : getAllTools();
    const useTools = Array.isArray(tools) && tools.length > 0;
    const formattedTools = useTools ? this.formatTools(tools) : undefined;

    // Ensure model is always set
    const modelToUse = this.model || OpenAIProvider.DEFAULT_MODEL;

    // o-series reasoning models use max_completion_tokens and default temperature=1
    const isReasoning = /^o\d/.test(modelToUse);
    const tokenKey = isReasoning ? 'max_completion_tokens' : 'max_tokens';
    const requestOptions = {
      model: modelToUse,
      messages: messages,
      temperature: isReasoning ? 1 : (options.temperature ?? 0.7),
      [tokenKey]: options.max_tokens ?? 8192
    };
    if (useTools) {
      requestOptions.tools = formattedTools;
      requestOptions.tool_choice = options.tool_choice || 'auto';
    }

    const response = await this.client.chat.completions.create(requestOptions);

    const message = response.choices[0].message;
    
    return {
      content: message.content,
      toolCalls: this.parseToolCalls(message),
      usage: response.usage,
      model: response.model
    };
  }

  parseToolCalls(response) {
    if (!response.tool_calls || response.tool_calls.length === 0) {
      return [];
    }

    return response.tool_calls.map(toolCall => ({
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: JSON.parse(toolCall.function.arguments || '{}')
    }));
  }

  validateApiKey(apiKey) {
    return super.validateApiKey(apiKey) && apiKey.startsWith('sk-');
  }
}

module.exports = OpenAIProvider;

