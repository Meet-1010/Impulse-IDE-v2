const { validateToolCall } = require('./toolSchema');

/**
 * Tool Executor
 * Executes structured tool instructions from the AI Agent
 * Routes to appropriate service handlers
 */
class ToolExecutor {
  constructor(arduinoService, serialMonitor, errorMemory, aiMemory) {
    this.arduinoService = arduinoService;
    this.serialMonitor = serialMonitor;
    this.errorMemory = errorMemory;
    this.aiMemory = aiMemory;
    this.serialBuffer = []; // Buffer for serial output
    this.maxBufferSize = 1000; // Maximum lines to buffer

    // UI state callbacks - set by the main process
    this.uiCallbacks = null;

    // Available baud rates
    this.availableBaudRates = [
      300, 1200, 2400, 4800, 9600, 19200, 38400,
      57600, 74880, 115200, 230400, 250000, 500000, 1000000, 2000000
    ];
  }

  /**
   * Set UI callbacks for interacting with the renderer
   */
  setUICallbacks(callbacks) {
    this.uiCallbacks = callbacks;
  }

  /**
   * Execute a tool call
   * @param {Object} toolCall - Structured tool instruction from agent
   * @returns {Promise<Object>} Execution result
   */
  async execute(toolCall) {
    // Validate tool call structure
    const validation = validateToolCall(toolCall);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
        tool: toolCall.name
      };
    }

    try {
      let result;

      switch (toolCall.name) {
        // Arduino Operations
        case 'compile_sketch':
          result = await this.executeCompile(toolCall.arguments);
          break;
        case 'upload_sketch':
          result = await this.executeUpload(toolCall.arguments);
          break;
        case 'list_boards':
          result = await this.executeListBoards();
          break;
        case 'list_ports':
          result = await this.executeListPorts();
          break;

        // Serial Monitor Operations
        case 'connect_serial':
          result = await this.executeConnectSerial(toolCall.arguments);
          break;
        case 'disconnect_serial':
          result = await this.executeDisconnectSerial();
          break;
        case 'send_serial':
          result = await this.executeSendSerial(toolCall.arguments);
          break;
        case 'read_serial':
          result = await this.executeReadSerial(toolCall.arguments);
          break;
        case 'auto_detect_baud':
          result = await this.executeAutoDetectBaud(toolCall.arguments);
          break;

        // Baud Rate Operations
        case 'get_baud_rate':
          result = await this.executeGetBaudRate();
          break;
        case 'set_baud_rate':
          result = await this.executeSetBaudRate(toolCall.arguments);
          break;
        case 'get_available_baud_rates':
          result = this.executeGetAvailableBaudRates();
          break;

        // Code Editor Operations
        case 'get_editor_code':
          result = await this.executeGetEditorCode();
          break;
        case 'set_editor_code':
          result = await this.executeSetEditorCode(toolCall.arguments);
          break;
        case 'edit_code':
          result = await this.executeEditCode(toolCall.arguments);
          break;
        case 'search_code':
          result = await this.executeSearchCode(toolCall.arguments);
          break;
        case 'replace_in_code':
          result = await this.executeReplaceInCode(toolCall.arguments);
          break;
        case 'get_current_sketch_path':
          result = await this.executeGetCurrentSketchPath();
          break;
        case 'save_sketch':
          result = await this.executeSaveSketch(toolCall.arguments);
          break;

        // Analysis Operations
        case 'analyze_error':
          result = await this.executeAnalyzeError(toolCall.arguments);
          break;
        case 'search_memory':
          result = await this.executeSearchMemory(toolCall.arguments);
          break;
        case 'record_fix':
          result = await this.executeRecordFix(toolCall.arguments);
          break;

        // State Operations
        case 'get_current_state':
          result = await this.executeGetCurrentState();
          break;

        // Playground Operations
        case 'update_playground':
          result = await this.executeUpdatePlayground(toolCall.arguments);
          break;

        default:
          return {
            success: false,
            error: `Unknown tool: ${toolCall.name}`,
            tool: toolCall.name
          };
      }

      // Record execution in memory (matches aiMemory.recordExecution(toolCall, result) signature)
      if (this.aiMemory && this.aiMemory.recordExecution) {
        await this.aiMemory.recordExecution(
          { name: toolCall.name, arguments: toolCall.arguments },
          { success: result.success !== false, error: result.error, executionTime: result.executionTime }
        );
      }

      const ok = !(result && typeof result === 'object' && result.success === false);
      return ok
        ? { success: true, tool: toolCall.name, result }
        : { success: false, tool: toolCall.name, error: result.error || 'Tool failed', result };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        tool: toolCall.name
      };
    }
  }

  // Arduino Operation Implementations
  async executeCompile(args = {}) {
    // Resolve from args or UI state when user says "compile" without parameters
    let sketchPath = (args.sketchPath || '').trim();
    let boardFQBN = (args.boardFQBN || '').trim();
    if (this.uiCallbacks) {
      if (!sketchPath && this.uiCallbacks.getCurrentSketchPath) {
        sketchPath = (await this.uiCallbacks.getCurrentSketchPath()) || '';
      }
      if (!boardFQBN && this.uiCallbacks.getSelectedBoard) {
        boardFQBN = (await this.uiCallbacks.getSelectedBoard()) || '';
      }
    }
    if (!sketchPath) {
      return { success: false, error: 'No sketch open. Please open a .ino file first (Open Sketch in the sidebar).' };
    }
    if (!boardFQBN) {
      return { success: false, error: 'No board selected. Please select a board from the Board dropdown in the sidebar.' };
    }
    // Save editor content to disk before compiling
    if (this.uiCallbacks && this.uiCallbacks.saveSketch) {
      await this.uiCallbacks.saveSketch(sketchPath);
    }
    try {
      const compileResult = await this.arduinoService.compile(sketchPath, boardFQBN);
      if (compileResult && compileResult.success === false) {
        return { success: false, error: compileResult.error?.message || compileResult.error || compileResult.message || 'Compilation failed' };
      }
      return {
        output: compileResult.output,
        warnings: compileResult.warnings || [],
        success: true,
        message: compileResult.message
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        output: err.stdout || err.stderr
      };
    }
  }

  async executeUpload(args = {}) {
    // Resolve from args or UI state
    let sketchPath = (args.sketchPath || '').trim();
    let boardFQBN = (args.boardFQBN || '').trim();
    let port = (args.port || '').trim();
    if (this.uiCallbacks) {
      if (!sketchPath && this.uiCallbacks.getCurrentSketchPath) {
        sketchPath = (await this.uiCallbacks.getCurrentSketchPath()) || '';
      }
      if (!boardFQBN && this.uiCallbacks.getSelectedBoard) {
        boardFQBN = (await this.uiCallbacks.getSelectedBoard()) || '';
      }
      if (!port && this.uiCallbacks.getSelectedPort) {
        port = (await this.uiCallbacks.getSelectedPort()) || '';
      }
    }
    if (!sketchPath) {
      return { success: false, error: 'No sketch open. Please open a .ino file first (Open Sketch in the sidebar).' };
    }
    if (!boardFQBN) {
      return { success: false, error: 'No board selected. Please select a board from the Board dropdown.' };
    }
    if (!port) {
      return { success: false, error: 'No port selected. Please select a port from the Port dropdown (and connect your board via USB).' };
    }
    // Uploading drives real hardware: the user approves every agent upload.
    if (!this.uiCallbacks || !this.uiCallbacks.confirmUpload) {
      return { success: false, error: 'Upload needs user confirmation, which is unavailable right now.' };
    }
    const approved = await this.uiCallbacks.confirmUpload({ sketchPath, boardFQBN, port });
    if (!approved) {
      return { success: false, error: 'The user declined the upload. Do not retry unless they ask.' };
    }
    // Disconnect serial monitor to free the port (upload uses the same port)
    if (this.serialMonitor && this.serialMonitor.isConnected) {
      await this.serialMonitor.disconnect();
    }
    // Save editor content before uploading
    if (this.uiCallbacks && this.uiCallbacks.saveSketch) {
      await this.uiCallbacks.saveSketch(sketchPath);
    }
    try {
      const uploadResult = await this.arduinoService.upload(sketchPath, boardFQBN, port);
      if (uploadResult && uploadResult.success === false) {
        return { success: false, error: uploadResult.error?.message || uploadResult.error || uploadResult.message || 'Upload failed' };
      }
      return {
        output: uploadResult.output,
        port: uploadResult.port ?? port,
        boardFQBN,
        success: true,
        message: uploadResult.message || 'Upload complete'
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        output: err.stdout || err.stderr
      };
    }
  }

  async executeListBoards() {
    const boards = await this.arduinoService.listBoards();
    return { boards };
  }

  async executeListPorts() {
    const ports = await this.arduinoService.listPorts();
    return { ports };
  }

  // Serial Monitor Operation Implementations
  async executeConnectSerial(args) {
    const { port, baudRate = 115200 } = args;
    await this.serialMonitor.connect(port, baudRate);

    // Remove previous listener to prevent duplicates/leaks
    if (this._serialDataHandler) {
      this.serialMonitor.removeListener('data', this._serialDataHandler);
    }
    // Set up listener to buffer serial data
    this._serialDataHandler = (data) => {
      this.addToBuffer(data);
    };
    this.serialMonitor.on('data', this._serialDataHandler);

    return {
      port,
      baudRate,
      connected: true
    };
  }

  async executeDisconnectSerial() {
    await this.serialMonitor.disconnect();
    return { connected: false };
  }

  async executeSendSerial(args) {
    const { data } = args;
    await this.serialMonitor.send(data);
    return { sent: data };
  }

  async executeReadSerial(args) {
    const { lines = 50 } = args;
    const recentLines = this.serialBuffer.slice(-lines);
    return {
      lines: recentLines,
      totalBuffered: this.serialBuffer.length
    };
  }

  async executeAutoDetectBaud(args) {
    const { port } = args;

    if (this.serialMonitor.tryBaudRates) {
      const detectedBaud = await this.serialMonitor.tryBaudRates(port);

      if (detectedBaud) {
        return {
          success: true,
          baudRate: detectedBaud,
          port
        };
      }
    }

    return {
      success: false,
      error: 'Could not detect baud rate',
      port
    };
  }

  // Baud Rate Operation Implementations
  async executeGetBaudRate() {
    if (this.uiCallbacks && this.uiCallbacks.getBaudRate) {
      const baudRate = await this.uiCallbacks.getBaudRate();
      return { baudRate };
    }

    // Fallback to serial monitor's current baud rate
    if (this.serialMonitor && this.serialMonitor.currentBaudRate) {
      return { baudRate: this.serialMonitor.currentBaudRate };
    }

    return { baudRate: null, error: 'No baud rate information available' };
  }

  async executeSetBaudRate(args) {
    const { baudRate } = args;

    // Validate baud rate
    if (!this.availableBaudRates.includes(baudRate)) {
      return {
        success: false,
        error: `Invalid baud rate: ${baudRate}. Available rates: ${this.availableBaudRates.join(', ')}`
      };
    }

    if (this.uiCallbacks && this.uiCallbacks.setBaudRate) {
      await this.uiCallbacks.setBaudRate(baudRate);
      return { success: true, baudRate };
    }

    return { success: false, error: 'Unable to set baud rate - UI callback not available' };
  }

  executeGetAvailableBaudRates() {
    return { baudRates: this.availableBaudRates };
  }

  // Code Editor Operation Implementations
  async executeGetEditorCode() {
    if (this.uiCallbacks && this.uiCallbacks.getEditorCode) {
      const code = await this.uiCallbacks.getEditorCode();
      return { code };
    }

    return { code: null, error: 'Unable to get editor code - UI callback not available' };
  }

  async executeSetEditorCode(args) {
    const { code } = args;

    if (this.uiCallbacks && this.uiCallbacks.setEditorCode) {
      await this.uiCallbacks.setEditorCode(code);
      return { success: true };
    }

    return { success: false, error: 'Unable to set editor code - UI callback not available' };
  }

  async executeEditCode(args) {
    const { operation, startLine, endLine, newCode } = args;

    if (!this.uiCallbacks || !this.uiCallbacks.getEditorCode || !this.uiCallbacks.setEditorCode) {
      return { success: false, error: 'Unable to edit code - UI callbacks not available' };
    }

    const currentCode = await this.uiCallbacks.getEditorCode();
    const lines = currentCode.split('\n');

    // Convert to 0-indexed
    const start = startLine - 1;
    const end = endLine ? endLine - 1 : start;

    let newLines;

    switch (operation) {
      case 'replace': {
        const codeLines = newCode ? newCode.split('\n') : [];
        newLines = [...lines.slice(0, start), ...codeLines, ...lines.slice(end + 1)];
        break;
      }

      case 'insert': {
        const insertLines = newCode ? newCode.split('\n') : [];
        newLines = [...lines.slice(0, start), ...insertLines, ...lines.slice(start)];
        break;
      }

      case 'delete':
        newLines = [...lines.slice(0, start), ...lines.slice(end + 1)];
        break;

      default:
        return { success: false, error: `Unknown operation: ${operation}` };
    }

    const newCodeStr = newLines.join('\n');
    await this.uiCallbacks.setEditorCode(newCodeStr);

    return {
      success: true,
      operation,
      linesAffected: end - start + 1,
      newLineCount: newLines.length
    };
  }

  async executeSearchCode(args) {
    const { searchText, isRegex = false } = args;

    if (!this.uiCallbacks || !this.uiCallbacks.getEditorCode) {
      return { success: false, error: 'Unable to search code - UI callback not available' };
    }

    const code = await this.uiCallbacks.getEditorCode();
    const lines = code.split('\n');
    const matches = [];

    const regex = isRegex ? new RegExp(searchText, 'gi') : null;

    lines.forEach((line, index) => {
      let found = false;

      if (isRegex) {
        found = regex.test(line);
        regex.lastIndex = 0; // Reset regex state
      } else {
        found = line.toLowerCase().includes(searchText.toLowerCase());
      }

      if (found) {
        matches.push({
          lineNumber: index + 1,
          content: line.trim()
        });
      }
    });

    return {
      searchText,
      matchCount: matches.length,
      matches: matches.slice(0, 50) // Limit results
    };
  }

  async executeReplaceInCode(args) {
    const { searchText, replaceText, replaceAll = false } = args;

    if (!this.uiCallbacks || !this.uiCallbacks.getEditorCode || !this.uiCallbacks.setEditorCode) {
      return { success: false, error: 'Unable to replace in code - UI callbacks not available' };
    }

    const code = await this.uiCallbacks.getEditorCode();
    let newCode;
    let count = 0;

    if (replaceAll) {
      const regex = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      count = (code.match(regex) || []).length;
      newCode = code.replace(regex, replaceText);
    } else {
      const index = code.indexOf(searchText);
      if (index !== -1) {
        newCode = code.substring(0, index) + replaceText + code.substring(index + searchText.length);
        count = 1;
      } else {
        newCode = code;
      }
    }

    await this.uiCallbacks.setEditorCode(newCode);

    return {
      success: true,
      searchText,
      replaceText,
      replacementCount: count
    };
  }

  async executeGetCurrentSketchPath() {
    if (this.uiCallbacks && this.uiCallbacks.getCurrentSketchPath) {
      const path = await this.uiCallbacks.getCurrentSketchPath();
      return { path };
    }

    return { path: null, error: 'Unable to get sketch path - UI callback not available' };
  }

  async executeSaveSketch(args) {
    const { path } = args;

    if (this.uiCallbacks && this.uiCallbacks.saveSketch) {
      await this.uiCallbacks.saveSketch(path);
      return { success: true, path };
    }

    return { success: false, error: 'Unable to save sketch - UI callback not available' };
  }

  // Analysis Operation Implementations
  async executeAnalyzeError(args) {
    const { errorMessage, context } = args;

    // First, search memory for similar errors
    let memoryResults = [];
    if (this.aiMemory && this.aiMemory.searchSimilarErrors) {
      memoryResults = await this.aiMemory.searchSimilarErrors(errorMessage);
    }

    // Use error memory service for pattern extraction
    let analyzedError = { suggestions: [] };
    if (this.errorMemory) {
      const error = new Error(errorMessage);
      analyzedError = await this.errorMemory.analyzeError(error);
    }

    return {
      errorMessage,
      context,
      memoryMatches: memoryResults,
      patternAnalysis: analyzedError,
      suggestions: analyzedError.suggestions
    };
  }

  async executeSearchMemory(args) {
    const { query, limit = 10 } = args;

    if (this.aiMemory && this.aiMemory.searchSimilarErrors) {
      const results = await this.aiMemory.searchSimilarErrors(query, limit);
      return { results };
    }

    return { results: [] };
  }

  async executeRecordFix(args) {
    const { errorSignature, fix, context } = args;

    if (this.aiMemory && this.aiMemory.recordFix) {
      const record = await this.aiMemory.recordFix(errorSignature, fix, context);
      return { record };
    }

    return { success: false, error: 'Memory not available' };
  }

  // State Operations
  async executeGetCurrentState() {
    const state = {
      serialConnected: this.serialMonitor ? this.serialMonitor.isConnected : false,
      serialBufferSize: this.serialBuffer.length,
      availableBaudRates: this.availableBaudRates,
      currentSerialBaudRate: this.serialMonitor ? this.serialMonitor.currentBaudRate : null
    };

    // Get UI state if available
    if (this.uiCallbacks) {
      if (this.uiCallbacks.getBaudRate) {
        state.currentBaudRate = await this.uiCallbacks.getBaudRate();
      }
      if (this.uiCallbacks.getCurrentSketchPath) {
        state.currentSketchPath = await this.uiCallbacks.getCurrentSketchPath();
      }
      if (this.uiCallbacks.getSelectedBoard) {
        state.selectedBoard = await this.uiCallbacks.getSelectedBoard();
      }
      if (this.uiCallbacks.getSelectedPort) {
        state.selectedPort = await this.uiCallbacks.getSelectedPort();
      }
      if (this.uiCallbacks.getLastCompileResult) {
        state.lastCompileResult = await this.uiCallbacks.getLastCompileResult();
      }
    }

    return state;
  }

  // Playground Operations
  async executeUpdatePlayground(args) {
    const { content, append = true } = args;

    if (!content || typeof content !== 'string') {
      return { success: false, error: 'Content is required and must be a string' };
    }

    if (this.uiCallbacks && this.uiCallbacks.setPlayground) {
      await this.uiCallbacks.setPlayground(content, append);
      return { success: true, message: 'Playground updated' };
    }

    return { success: false, error: 'Unable to update playground - UI callback not available' };
  }

  // Helper Methods
  addToBuffer(data) {
    const entry = {
      timestamp: data.timestamp || new Date().toISOString(),
      data: data.data || data,
      baudRate: data.baudRate
    };

    this.serialBuffer.push(entry);

    // Maintain buffer size
    if (this.serialBuffer.length > this.maxBufferSize) {
      this.serialBuffer.shift();
    }
  }

  clearBuffer() {
    this.serialBuffer = [];
  }
}

module.exports = ToolExecutor;
