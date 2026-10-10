const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const ErrorHandler = require('../utils/errorHandler');
const notifications = require('../utils/notifications');

/**
 * Arduino CLI Service
 * Handles all Arduino CLI operations: compile, upload, board/port listing
 * 
 * Architecture Components:
 * 1️⃣ Command Builder - constructs CLI commands with correct flags
 * 2️⃣ Process Runner - executes commands, captures stdout/stderr
 * 3️⃣ Output Parser - interprets results, detects success/failure
 * 
 * SECURITY: All CLI commands use spawn() with argument arrays.
 * Never use shell string interpolation with user-controlled input.
 */
class ArduinoService {
  /** @param {{ cliPath?: string|null }} [opts] the arduino-cli to run (see services/toolchain.js) */
  constructor({ cliPath = null } = {}) {
    // GUI-launched apps on macOS don't inherit the shell PATH, so the
    // toolchain service resolves an absolute path; PATH lookup is the fallback.
    this.cliPath = cliPath || 'arduino-cli';
    this.coreIndexed = false;
  }

  // ==================== 2️⃣ Process Runner ====================

  /**
   * Safe command runner using spawn() with argument arrays.
   * NEVER passes user input through a shell.
   * @param {string[]} args - Array of arguments for arduino-cli
   * @param {Object} options - spawn options (cwd, timeout, etc.)
   * @returns {Promise<{success: boolean, stdout: string, stderr: string, code?: number}>}
   */
  async runCommand(args, options = {}) {
    return new Promise((resolve) => {
      const { timeout = 60000, ...spawnOptions } = options;
      const proc = spawn(this.cliPath, args, {
        windowsHide: true,
        ...spawnOptions
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        finish(code === 0 ? { success: true, stdout, stderr } : { success: false, stdout, stderr, code });
      });

      proc.on('error', (error) => {
        finish({ success: false, stdout: '', stderr: error.message, code: error.code });
      });

      const timer = setTimeout(() => {
        proc.kill();
        finish({ success: false, stdout, stderr: 'Command timed out', code: 'TIMEOUT' });
      }, timeout);
    });
  }

  async checkCLI() {
    try {
      const result = await this.runCommand(['version']);
      return result.success && result.stdout.trim().length > 0;
    } catch (error) {
      return false;
    }
  }

  async ensureCoreIndexed() {
    if (this.coreIndexed) return;
    
    try {
      await this.runCommand(['core', 'update-index']);
      this.coreIndexed = true;
    } catch (error) {
      console.warn('Failed to update core index:', error.message);
    }
  }

  // ==================== 3️⃣ Output Parser ====================

  /**
   * Parse compile output to extract useful information
   */
  parseCompileOutput(stdout, stderr) {
    const combined = stdout + '\n' + stderr;
    const lines = combined.split('\n');
    
    const result = {
      success: false,
      programSize: null,
      maxSize: null,
      usagePercent: null,
      warnings: [],
      errors: [],
      message: ''
    };
    
    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      
      // Parse success - "Sketch uses X bytes"
      const sizeMatch = line.match(/Sketch uses (\d+) bytes \((\d+)%\) of program storage space/);
      if (sizeMatch) {
        result.success = true;
        result.programSize = parseInt(sizeMatch[1]);
        result.usagePercent = parseInt(sizeMatch[2]);
      }
      
      // Parse max size
      const maxMatch = line.match(/Maximum is (\d+) bytes/);
      if (maxMatch) {
        result.maxSize = parseInt(maxMatch[1]);
      }
      
      // Collect errors
      if (lowerLine.includes('error:') || 
          lowerLine.includes('was not declared') ||
          lowerLine.includes('undefined reference')) {
        result.errors.push(line.trim());
      }
      
      // Collect warnings
      if (lowerLine.includes('warning:') && !lowerLine.includes('error:')) {
        result.warnings.push(line.trim());
      }
    }
    
    // Generate summary message
    if (result.success) {
      result.message = `Compilation successful. Uses ${result.programSize} bytes (${result.usagePercent}%)`;
    } else if (result.errors.length > 0) {
      result.message = result.errors[0];
    } else {
      result.message = 'Compilation failed';
    }
    
    return result;
  }

  /**
   * Parse upload output - improved detection for multiple board types
   */
  parseUploadOutput(stdout, stderr) {
    const combined = stdout + '\n' + stderr;
    const lines = combined.split('\n');
    
    const result = {
      success: false,
      progress: 0,
      errors: [],
      warnings: [],
      message: ''
    };
    
    // Success indicators for various board types
    const successPatterns = [
      /100%/,                                          // General progress completion
      /avrdude.*done/i,                                // AVR boards (Uno, Nano, Mega)
      /avrdude.*verified/i,                            // AVR verification
      /avrdude.*flash verified/i,                      // AVR flash verified
      /writing.*done/i,                                // Generic writing done
      /hard resetting via rts pin/i,                   // ESP32/ESP8266 reset after upload
      /leaving.*hard reset/i,                          // ESP32 variant
      /hash of data verified/i,                        // ESP32 hash verification
      /compressed \d+ bytes to \d+/i,                  // ESP32 compression success
      /wrote \d+ bytes/i,                              // Generic write success
      /flash written and target reset/i,              // STM32 boards
      /upload.*complete/i,                             // Generic upload complete
      /successfully/i,                                 // Generic success
      /programming.*ok/i,                              // Some programmers
    ];
    
    // Error patterns - more specific to avoid false positives
    const errorPatterns = [
      { pattern: /error:/i, type: 'error' },
      { pattern: /fatal error/i, type: 'error' },
      { pattern: /upload failed/i, type: 'error' },
      { pattern: /timeout/i, type: 'error' },
      { pattern: /permission denied/i, type: 'error' },
      { pattern: /access denied/i, type: 'error' },
      { pattern: /port.*not found/i, type: 'error' },
      { pattern: /no such file or directory/i, type: 'error' },
      { pattern: /device not found/i, type: 'error' },
      { pattern: /programmer.*not responding/i, type: 'error' },
      { pattern: /sync error/i, type: 'error' },
      { pattern: /stk500.*not in sync/i, type: 'error' },
      { pattern: /espcomm_upload_mem failed/i, type: 'error' },
      { pattern: /a]fatal error occurred/i, type: 'error' },
      { pattern: /serial port.*busy/i, type: 'error' },
    ];
    
    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      
      // Check for success indicators
      for (const pattern of successPatterns) {
        if (pattern.test(line)) {
          result.success = true;
          result.progress = 100;
          break;
        }
      }
      
      // Parse progress percentage
      const progressMatch = line.match(/(\d+)%/);
      if (progressMatch) {
        const progress = parseInt(progressMatch[1]);
        result.progress = Math.max(result.progress, progress);
        if (progress >= 100) {
          result.success = true;
        }
      }
      
      // Check for errors (but not false positives like "error correction")
      for (const { pattern } of errorPatterns) {
        if (pattern.test(line)) {
          // Exclude false positives
          if (!lowerLine.includes('error correction') && 
              !lowerLine.includes('no error')) {
            result.errors.push(line.trim());
          }
        }
      }
      
      // Collect warnings
      if (lowerLine.includes('warning:') && !lowerLine.includes('error:')) {
        result.warnings.push(line.trim());
      }
    }
    
    // If we found errors but also success indicators, check if it's a fatal error
    if (result.errors.length > 0) {
      const hasFatalError = result.errors.some(e => 
        /fatal|failed|cannot|unable/i.test(e)
      );
      if (hasFatalError) {
        result.success = false;
      }
    }
    
    // Generate message
    if (result.success) {
      result.message = 'Upload complete';
    } else if (result.errors.length > 0) {
      // Get the most relevant error message
      const relevantError = result.errors.find(e => 
        /error:|failed|timeout|denied|not found/i.test(e)
      ) || result.errors[0];
      result.message = relevantError;
    } else {
      result.message = 'Upload status unknown - check output for details';
    }
    
    return result;
  }

  // ==================== Board/Port Management ====================

  /**
   * List all installed boards using JSON output
   * Uses spawn for large outputs to avoid buffer overflow
   */
  async listBoards() {
    await this.ensureCoreIndexed();
    
    try {
      // Use spawn for large outputs to handle buffer issues
      const boards = await this.listBoardsWithSpawn();
      
      if (boards.length === 0) {
        return this.getCommonBoards();
      }
      
      // Limit to first 150 boards to prevent UI slowdown
      const limitedBoards = boards.slice(0, 150);
      
      // Add common boards at the top if they exist
      const commonFQBNs = [
        'arduino:avr:uno',
        'arduino:avr:nano',
        'arduino:avr:nano:cpu=atmega328old',
        'arduino:avr:mega',
        'arduino:avr:leonardo',
        'esp32:esp32:esp32',
        'esp32:esp32:esp32s3',
        'esp8266:esp8266:nodemcuv2',
        'esp8266:esp8266:generic'
      ];
      
      const sortedBoards = [];
      
      // Add common boards first
      for (const fqbn of commonFQBNs) {
        const found = limitedBoards.find(b => b.fqbn === fqbn);
        if (found && !sortedBoards.some(b => b.fqbn === found.fqbn)) {
          sortedBoards.push(found);
        }
      }
      
      // Add remaining boards
      for (const board of limitedBoards) {
        if (!sortedBoards.some(b => b.fqbn === board.fqbn)) {
          sortedBoards.push(board);
        }
      }
      
      return sortedBoards;
    } catch (error) {
      console.error('Failed to list boards:', error.message);
      return this.getCommonBoards();
    }
  }

  /**
   * List boards using spawn to handle large outputs
   */
  async listBoardsWithSpawn() {
    return new Promise((resolve, _reject) => {
      const args = ['board', 'listall', '--format', 'json'];
      const boardProcess = spawn(this.cliPath, args);
      
      let stdout = '';
      let stderr = '';
      
      boardProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      boardProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      boardProcess.on('close', (code) => {
        if (code !== 0) {
          console.error('Board list error:', stderr);
          resolve([]); // Return empty array, will fall back to common boards
          return;
        }
        
        try {
          const data = JSON.parse(stdout);
          const boards = [];
          
          // Handle different JSON structures from different CLI versions
          const boardList = data.boards || data;
          
          if (Array.isArray(boardList)) {
            for (const board of boardList) {
              if (board.fqbn && board.name) {
                boards.push({
                  name: board.name,
                  fqbn: board.fqbn
                });
              }
            }
          }
          
          resolve(boards);
        } catch (parseError) {
          console.error('Failed to parse board list:', parseError.message);
          resolve([]);
        }
      });
      
      boardProcess.on('error', (error) => {
        console.error('Failed to spawn board list process:', error.message);
        resolve([]);
      });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        boardProcess.kill();
        resolve([]);
      }, 30000);
    });
  }

  getCommonBoards() {
    return [
      { name: 'Arduino Uno', fqbn: 'arduino:avr:uno' },
      { name: 'Arduino Nano', fqbn: 'arduino:avr:nano' },
      { name: 'Arduino Nano (Old Bootloader)', fqbn: 'arduino:avr:nano:cpu=atmega328old' },
      { name: 'Arduino Mega 2560', fqbn: 'arduino:avr:mega' },
      { name: 'Arduino Leonardo', fqbn: 'arduino:avr:leonardo' },
      { name: 'ESP32 Dev Module', fqbn: 'esp32:esp32:esp32' },
      { name: 'ESP8266 NodeMCU', fqbn: 'esp8266:esp8266:nodemcuv2' },
      { name: 'ESP8266 Generic', fqbn: 'esp8266:esp8266:generic' }
    ];
  }

  /**
   * List connected boards/ports using JSON output
   */
  /**
   * Connected ports. Throws when arduino-cli fails, so callers can tell
   * "no boards plugged in" apart from "couldn't ask".
   */
  async listPorts() {
    let result = await this.runCommand(['board', 'list', '--format', 'json']);
    if (!result.success) {
      // board list can fail transiently while another CLI call holds the lock.
      await new Promise(resolve => setTimeout(resolve, 400));
      result = await this.runCommand(['board', 'list', '--format', 'json']);
    }
    if (!result.success) throw new Error(result.stderr.trim() || 'arduino-cli board list failed');

    const data = JSON.parse(result.stdout);
    const portList = data.detected_ports || data.ports || data;
    const ports = [];
    if (Array.isArray(portList)) {
      for (const item of portList) {
        const port = item.port || item;
        if (port && port.address) {
          const boardName = item.matching_boards && item.matching_boards[0]
            ? item.matching_boards[0].name
            : (port.protocol_label || 'Unknown');
          const props = port.properties || {};
          ports.push({ port: port.address, protocol: port.protocol || 'serial', board: boardName, vid: props.vid || null, pid: props.pid || null });
        }
      }
    }
    return ports;
  }

  /**
   * Validate FQBN format
   */
  validateFQBN(fqbn) {
    if (typeof fqbn !== 'string' || /\s/.test(fqbn)) return false;
    // vendor:architecture:board[:option=value,...], e.g. arduino:avr:uno
    const parts = fqbn.split(':');
    return parts.length >= 3 && parts.length <= 4 && parts.every(p => p.length > 0);
  }

  // ==================== Compile/Upload Operations ====================

  /**
   * Compile an Arduino sketch
   */
  async compile(sketchPath, boardFQBN) {
    try {
      // Input validation with user-friendly messages
      const validation = ErrorHandler.validateInput(
        { sketchPath, boardFQBN },
        {
          sketchPath: { required: true, type: 'string', minLength: 1 },
          boardFQBN: { required: true, type: 'string', minLength: 5 }
        }
      );

      if (!validation.valid) {
        throw new Error(`Invalid input: ${validation.errors.join(', ')}`);
      }

      if (!this.validateFQBN(boardFQBN)) {
        throw new Error(`Invalid FQBN format: "${boardFQBN}". Expected format: vendor:architecture:board (e.g., arduino:avr:uno)`);
      }

      // Verify sketch exists
      try {
        await fs.access(sketchPath);
      } catch (error) {
        throw new Error(`Sketch file not found: ${sketchPath}. Please check the file path.`);
      }

      // Check if Arduino CLI is available
      if (!await this.checkCLI()) {
        throw new Error('Arduino CLI is not available. Please install Arduino CLI and ensure it is in your PATH.');
      }

      await this.ensureCoreIndexed();

      // Show progress notification
      const progressId = notifications.progress('Compiling sketch...', 0);

      return new Promise((resolve, reject) => {
        const args = [
          'compile',
          '--fqbn', boardFQBN,
          '--verbose',
          sketchPath
        ];

        const compileProcess = spawn(this.cliPath, args, {
          cwd: path.dirname(sketchPath),
          timeout: 120000 // 2 minute timeout
        });

        let stdout = '';
        let stderr = '';
        let progress = 10;

        const updateProgress = () => {
          progress = Math.min(progress + 10, 90);
          notifications.updateProgress(progressId, progress);
        };

        const progressInterval = setInterval(updateProgress, 2000);

        compileProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        compileProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        compileProcess.on('close', (code) => {
          clearInterval(progressInterval);
          notifications.dismiss(progressId);

          // Use the output parser
          const parsed = this.parseCompileOutput(stdout, stderr);
          
          if (code === 0 || parsed.success) {
            notifications.success('Sketch compiled successfully!');
            resolve({
              success: true,
              output: stdout,
              warnings: parsed.warnings,
              programSize: parsed.programSize,
              usagePercent: parsed.usagePercent,
              message: parsed.message || 'Compilation completed successfully'
            });
          } else {
            const errorMessage = ArduinoService.explainToolchainError(stdout + '\n' + stderr)
              || parsed.message || `Compilation failed with exit code ${code}`;
            notifications.error(`Compilation failed: ${errorMessage}`);
            const err = new Error(errorMessage);
            // Attach parsed errors + full build output so callers (and the AI)
            // can see the complete compilation diagnostics.
            err.errors = parsed.errors;
            err.output = (stdout + '\n' + stderr).trim();
            reject(err);
          }
        });

        compileProcess.on('error', (error) => {
          clearInterval(progressInterval);
          notifications.dismiss(progressId);
          
          const friendlyError = new Error(`Failed to start compilation: ${error.message}`);
          notifications.error('Failed to start compilation process');
          reject(friendlyError);
        });

        // Handle timeout
        setTimeout(() => {
          if (!compileProcess.killed) {
            compileProcess.kill();
            clearInterval(progressInterval);
            notifications.dismiss(progressId);
            notifications.error('Compilation timed out after 2 minutes');
            reject(new Error('Compilation timed out. The sketch may be too complex or there may be an issue with the Arduino CLI.'));
          }
        }, 120000);
      });

    } catch (error) {
      return ErrorHandler.handle(error, 'Arduino Compile', {
        userMessage: ErrorHandler.getFriendlyMessage(error, 'compile'),
        metadata: { sketchPath, boardFQBN }
      });
    }
  }

  /**
   * Compile sketch and return the generated .hex file content for simulation.
   */
  async compileHex(sketchPath, boardFQBN) {
    const os = require('os');
    const fs = require('fs');
    if (!this.validateFQBN(boardFQBN)) {
      return { success: false, error: `Invalid board: "${boardFQBN}"` };
    }
    const outputDir = path.join(os.tmpdir(), `impulse-hex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(outputDir, { recursive: true });

    return new Promise((resolve) => {
      const args = [
        'compile',
        '--fqbn', boardFQBN,
        '--output-dir', outputDir,
        sketchPath,
      ];

      const proc = spawn(this.cliPath, args, { cwd: path.dirname(sketchPath), timeout: 120000 });
      let stderr = '';

      proc.stderr.on('data', d => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          fs.rmSync(outputDir, { recursive: true, force: true });
          resolve({ success: false, error: ArduinoService.explainToolchainError(stderr) || stderr });
          return;
        }
        // The application image, not the copy merged with the bootloader.
        const files = fs.readdirSync(outputDir);
        const hexFile = files.find(f => f.endsWith('.hex') && !f.endsWith('.with_bootloader.hex'));
        if (!hexFile) {
          fs.rmSync(outputDir, { recursive: true, force: true });
          resolve({ success: false, error: 'No .hex output found' });
          return;
        }
        const hex = fs.readFileSync(path.join(outputDir, hexFile), 'utf8');
        fs.rmSync(outputDir, { recursive: true, force: true });
        resolve({ success: true, hex });
      });

      proc.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }

  /**
   * Translate known toolchain failures into an actionable message.
   * @returns {string|null}
   */
  static explainToolchainError(text) {
    if (!text) return null;
    if (/bad CPU type in executable/i.test(text)) {
      return 'The installed board toolchain is built for Intel Macs and needs Rosetta 2. ' +
        'Install it with: softwareupdate --install-rosetta --agree-to-license, then try again.';
    }
    if (/platform not installed|Platform '.+' not found/i.test(text)) {
      return 'The core for this board is not installed. Open Board Manager and install it, then try again.';
    }
    return null;
  }

  sketchDir(sketchPath) {
    return sketchPath.toLowerCase().endsWith('.ino') ? path.dirname(sketchPath) : sketchPath;
  }

  /**
   * Compile and export the .hex/.bin/.elf next to the sketch (sketch/build/<fqbn>/).
   */
  async exportBinaries(sketchPath, boardFQBN) {
    if (!this.validateFQBN(boardFQBN)) return { success: false, error: 'Select a board first.' };
    const dir = this.sketchDir(sketchPath);
    const result = await this.runCommand(['compile', '--fqbn', boardFQBN, '--export-binaries', dir], { cwd: dir, timeout: 180000 });
    if (!result.success) {
      return { success: false, error: ArduinoService.explainToolchainError(result.stderr) || result.stderr.trim() || 'Export failed' };
    }
    const outputDir = path.join(dir, 'build', boardFQBN.split(':').slice(0, 3).join('.'));
    let files = [];
    try { files = (await fs.readdir(outputDir)).filter(f => /\.(hex|bin|elf|eep|uf2)$/i.test(f)); } catch { /* listed below as empty */ }
    return { success: true, outputDir, files };
  }

  /**
   * Zip the sketch folder with `arduino-cli sketch archive`.
   */
  async archiveSketch(sketchPath, destinationZip) {
    const dir = this.sketchDir(sketchPath);
    const result = await this.runCommand(['sketch', 'archive', dir, destinationZip], { timeout: 120000 });
    if (!result.success) return { success: false, error: result.stderr.trim() || 'Archive failed' };
    return { success: true, archivePath: destinationZip };
  }

  /**
   * A board's menu options (USB CDC On Boot, Flash Size, PSRAM, CPU…), as
   * Arduino IDE shows them under Tools.
   * @returns {Promise<{ option: string, label: string, values: { value: string, label: string, isDefault: boolean }[] }[]>}
   */
  async boardOptions(boardFQBN) {
    const base = String(boardFQBN || '').split(':').slice(0, 3).join(':');
    if (!this.validateFQBN(base)) return [];
    this._optionCache = this._optionCache || new Map();
    if (this._optionCache.has(base)) return this._optionCache.get(base);
    const result = await this.runCommand(['board', 'details', '-b', base, '--format', 'json']);
    if (!result.success) return [];
    try {
      const data = JSON.parse(result.stdout);
      const options = (data.config_options || []).filter(o => o && o.option && Array.isArray(o.values)).map(o => ({
        option: o.option,
        label: o.option_label || o.option,
        values: o.values.map(v => ({ value: v.value, label: v.value_label || v.value, isDefault: !!v.selected }))
      }));
      this._optionCache.set(base, options);
      return options;
    } catch {
      return [];
    }
  }

  /**
   * Programmers available for a board (e.g. AVRISP mkII, USBasp).
   * @returns {Promise<{id: string, name: string}[]>}
   */
  async listProgrammers(boardFQBN) {
    if (!this.validateFQBN(boardFQBN)) return [];
    const result = await this.runCommand(['board', 'details', '-b', boardFQBN, '--format', 'json']);
    if (!result.success) return [];
    try {
      const data = JSON.parse(result.stdout);
      return (data.programmers || []).filter(p => p && p.id).map(p => ({ id: p.id, name: p.name || p.id }));
    } catch {
      return [];
    }
  }

  /**
   * Compile and upload through an external programmer (ISP).
   */
  async uploadWithProgrammer(sketchPath, boardFQBN, programmerId, port) {
    if (!this.validateFQBN(boardFQBN)) return { success: false, error: 'Select a board first.' };
    const dir = this.sketchDir(sketchPath);
    const args = ['compile', '--fqbn', boardFQBN, '--upload', '--programmer', programmerId];
    if (port) args.push('--port', port);
    args.push(dir);
    const result = await this.runCommand(args, { cwd: dir, timeout: 240000 });
    if (!result.success) {
      return { success: false, error: ArduinoService.explainToolchainError(result.stderr) || result.stderr.trim() || 'Upload failed' };
    }
    return { success: true, output: result.stdout };
  }

  /**
   * Hardware details for a connected port (VID/PID, serial number, matching boards).
   */
  async boardInfo(port) {
    const result = await this.runCommand(['board', 'list', '--format', 'json']);
    if (!result.success) return { success: false, error: result.stderr.trim() || 'Could not list boards' };
    try {
      const data = JSON.parse(result.stdout);
      const list = data.detected_ports || data.ports || data;
      const entry = (Array.isArray(list) ? list : []).find(item => (item.port || item)?.address === port);
      if (!entry) return { success: false, error: `No device found on ${port}. Is it still plugged in?` };
      const p = entry.port || entry;
      const props = p.properties || {};
      return {
        success: true,
        info: {
          port: p.address,
          protocol: p.protocol_label || p.protocol || 'serial',
          vid: props.vid || null,
          pid: props.pid || null,
          serialNumber: props.serialNumber || null,
          boards: (entry.matching_boards || []).map(b => ({ name: b.name, fqbn: b.fqbn }))
        }
      };
    } catch {
      return { success: false, error: 'Could not read board list output' };
    }
  }

  /**
   * Upload to Arduino board
   */
  async upload(sketchPath, boardFQBN, port) {
    try {
      // Input validation
      const validation = ErrorHandler.validateInput(
        { sketchPath, boardFQBN, port },
        {
          sketchPath: { required: true, type: 'string', minLength: 1 },
          boardFQBN: { required: true, type: 'string', minLength: 5 },
          port: { required: true, type: 'string', minLength: 1 }
        }
      );

      if (!validation.valid) {
        throw new Error(`Invalid input: ${validation.errors.join(', ')}`);
      }

      if (!this.validateFQBN(boardFQBN)) {
        throw new Error(`Invalid FQBN format: "${boardFQBN}". Expected format: vendor:architecture:board`);
      }

      // Check the port is present (skip the check if listing itself fails;
      // the upload will report a missing port precisely).
      const availablePorts = await this.listPorts().catch(() => null);
      if (availablePorts && !availablePorts.some(p => p.port === port)) {
        throw new Error(`Port ${port} is not available. Please check if your device is connected.`);
      }

      // First compile
      const compileResult = await this.compile(sketchPath, boardFQBN);
      if (!compileResult.success) {
        throw new Error('Compilation failed. Cannot upload without successful compilation.');
      }

      // Show upload progress
      const progressId = notifications.progress('Uploading to board...', 0);

      return new Promise((resolve, reject) => {
        const args = [
          'upload',
          '--fqbn', boardFQBN,
          '--port', port,
          '--verbose',
          sketchPath
        ];

        const uploadProcess = spawn(this.cliPath, args, {
          cwd: path.dirname(sketchPath),
          timeout: 60000 // 1 minute timeout for upload
        });

        let stdout = '';
        let stderr = '';
        let progress = 10;

        const updateProgress = () => {
          progress = Math.min(progress + 15, 90);
          notifications.updateProgress(progressId, progress);
        };

        const progressInterval = setInterval(updateProgress, 1000);

        uploadProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        uploadProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        uploadProcess.on('close', (code) => {
          clearInterval(progressInterval);
          notifications.dismiss(progressId);

          // Use the output parser for messages/warnings only.
          const parsed = this.parseUploadOutput(stdout, stderr);

          // TRUST THE EXIT CODE. arduino-cli returns 0 only on a real, completed
          // upload; a non-zero code means it did NOT flash the board. The old
          // logic OR-ed in lenient stdout patterns (100%, "wrote N bytes", etc.)
          // which produced false "upload successful" when the upload actually
          // failed. Require code === 0.
          const hasCriticalErrors = parsed.errors.some(e =>
            /fatal|failed|cannot connect|access denied|permission denied/i.test(e)
          );

          if (code === 0 && !hasCriticalErrors) {
            notifications.success(`Successfully uploaded to ${port}!`);
            resolve({
              success: true,
              output: stdout + '\n' + stderr,
              port: port,
              message: parsed.message || 'Upload completed successfully',
              warnings: parsed.warnings
            });
          } else {
            // Provide detailed error message
            const errorMsg = parsed.errors.length > 0
              ? parsed.errors.join('\n')
              : (parsed.message || `Upload failed with exit code ${code}`);
            notifications.error(`Upload failed: ${errorMsg}`);
            reject(new Error(errorMsg + '\n\n' + (stdout + '\n' + stderr).trim()));
          }
        });

        uploadProcess.on('error', (error) => {
          clearInterval(progressInterval);
          notifications.dismiss(progressId);
          
          const friendlyError = new Error(`Failed to start upload: ${error.message}`);
          notifications.error('Failed to start upload process');
          reject(friendlyError);
        });

        // Handle timeout
        setTimeout(() => {
          if (!uploadProcess.killed) {
            uploadProcess.kill();
            clearInterval(progressInterval);
            notifications.dismiss(progressId);
            notifications.error('Upload timed out after 1 minute');
            reject(new Error('Upload timed out. Please check your connection and try again.'));
          }
        }, 60000);
      });

    } catch (error) {
      return ErrorHandler.handle(error, 'Arduino Upload', {
        userMessage: ErrorHandler.getFriendlyMessage(error, 'upload'),
        metadata: { sketchPath, boardFQBN, port }
      });
    }
  }

  /**
   * Upload only (without compiling first) - useful when already compiled
   */
  async uploadOnly(sketchPath, boardFQBN, port) {
    if (!sketchPath || !boardFQBN || !port) {
      throw new Error('Sketch path, board FQBN, and port are required');
    }

    return new Promise((resolve, reject) => {
      const args = [
        'upload',
        '--fqbn', boardFQBN,
        '--port', port,
        '--verbose',
        sketchPath
      ];

      const uploadProcess = spawn(this.cliPath, args, {
        cwd: path.dirname(sketchPath)
      });

      let stdout = '';
      let stderr = '';

      uploadProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      uploadProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      uploadProcess.on('close', (code) => {
        const parsed = this.parseUploadOutput(stdout, stderr);

        // Trust the exit code (see upload()): non-zero means the board was not flashed.
        if (code === 0) {
          resolve({
            success: true,
            output: stdout + '\n' + stderr,
            port: port,
            message: parsed.message || 'Upload complete'
          });
        } else {
          reject(new Error((parsed.message || `Upload failed with code ${code}`) + '\n\n' + (stdout + '\n' + stderr).trim()));
        }
      });

      uploadProcess.on('error', (error) => {
        reject(new Error(`Failed to start upload: ${error.message}`));
      });
    });
  }

  // ==================== Library Operations ====================

  /**
   * Update the library index (call before search for fresh results)
   */
  async libUpdateIndex() {
    const result = await this.runCommand(['lib', 'update-index']);
    return result.success;
  }

  /**
   * Search for libraries. Returns { libraries: [{ name, author, version, sentence, paragraph, category, available_versions }] }
   */
  async libSearch(query) {
    const q = query != null ? String(query).trim() : '';
    if (!q) return { libraries: [] };
    return new Promise((resolve, reject) => {
      const args = ['lib', 'search', '--format', 'json', '--omit-releases-details', q];
      const proc = spawn(this.cliPath, args);
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => {
        if (code !== 0) {
          reject(new Error(stderr || 'Library search failed'));
          return;
        }
        try {
          const data = JSON.parse(stdout);
          const libs = (data.libraries || []).slice(0, 100).map(lib => ({
            name: lib.name,
            author: lib.latest?.author || '',
            version: lib.latest?.version || (lib.available_versions && lib.available_versions[0]) || '',
            sentence: lib.latest?.sentence || '',
            paragraph: lib.latest?.paragraph || '',
            category: lib.latest?.category || 'Uncategorized',
            website: lib.latest?.website || '',
            available_versions: lib.available_versions || []
          }));
          resolve({ libraries: libs });
        } catch (e) {
          reject(new Error(`Failed to parse lib search: ${e.message}`));
        }
      });
      proc.on('error', err => reject(new Error(`Failed to run: ${err.message}`)));
    });
  }

  /**
   * Install a library. libSpec = "Name" or "Name@1.0.0"
   */
  async libInstall(libSpec) {
    const spec = String(libSpec || '').trim();
    if (!spec) throw new Error('Library name is required');
    return new Promise((resolve, reject) => {
      const args = ['lib', 'install', '--format', 'json', spec];
      const proc = spawn(this.cliPath, args);
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => {
        if (code === 0) {
          resolve({ success: true, output: stdout + stderr });
        } else {
          reject(new Error(stderr || stdout || `Install failed with code ${code}`));
        }
      });
      proc.on('error', err => reject(new Error(`Failed to run: ${err.message}`)));
    });
  }

  /**
   * List installed libraries. Returns { installed_libraries: [{ name, author, version, sentence, ... }] }
   */
  async libList() {
    const result = await this.runCommand(['lib', 'list', '--format', 'json']);
    if (!result.success) {
      throw new Error(result.stderr || 'Library list failed');
    }
    try {
      const data = JSON.parse(result.stdout);
      const libs = (data.installed_libraries || []).map(item => {
        const lib = item.library || item;
        return {
          name: lib.name,
          author: lib.author || '',
          version: lib.version || '',
          sentence: lib.sentence || '',
          paragraph: lib.paragraph || '',
          category: lib.category || 'Uncategorized',
          website: lib.website || '',
          install_dir: lib.install_dir
        };
      });
      return { installed_libraries: libs };
    } catch (e) {
      throw new Error(`Failed to parse lib list: ${e.message}`);
    }
  }

  /**
   * Uninstall a library by name
   */
  async libUninstall(libName) {
    const name = String(libName || '').trim();
    if (!name) throw new Error('Library name is required');
    const result = await this.runCommand(['lib', 'uninstall', name]);
    if (!result.success) {
      throw new Error(result.stderr || result.stdout || 'Uninstall failed');
    }
    return { success: true };
  }

  // ==================== Core / Board Manager ====================

  /**
   * Search installable cores (Boards Manager). Keyword optional.
   * Returns [{ id, name, latest, installed }] or similar.
   */
  async coreSearch(keyword = '') {
    await this.ensureCoreIndexed();
    const args = ['core', 'search', '--format', 'json'];
    if (keyword && String(keyword).trim()) args.push(String(keyword).trim());
    const result = await this.runCommand(args);
    if (!result.success) {
      throw new Error(result.stderr || 'Core search failed');
    }
    try {
      const data = JSON.parse(result.stdout);
      const raw = Array.isArray(data) ? data : (data?.platforms || data?.cores || data?.results || []);
      return this._normalizeCoreSearchResults(raw);
    } catch (e) {
      throw new Error(`Parse core search: ${e.message}`);
    }
  }

  _normalizeCoreSearchResults(platforms) {
    if (!Array.isArray(platforms)) return [];
    return platforms.map(p => {
      const id = p.id || p.platform?.id || '';
      const releases = p.releases || {};
      const versions = Object.keys(releases);
      const latestVer = versions.length ? versions[versions.length - 1] : '';
      const release = latestVer ? releases[latestVer] : null;
      const name = release?.name || p.name || p.platform?.name || id;
      return { id, name, latest: latestVer };
    }).filter(p => p.id);
  }

  /**
   * List installed cores. Returns array of { id, name, installed, latest }.
   */
  async coreList() {
    const result = await this.runCommand(['core', 'list', '--format', 'json']);
    if (!result.success) {
      return [];
    }
    try {
      const data = JSON.parse(result.stdout);
      const raw = Array.isArray(data) ? data : (data?.installed_platforms || data?.platforms || []);
      return Array.isArray(raw) ? raw.map(p => ({
        id: p.id || p.platform?.id || p.name,
        name: p.name || p.platform?.name || p.id,
        installed: p.installed || p.version || ''
      })) : [];
    } catch (e) {
      console.warn('Parse core list:', e.message);
      return [];
    }
  }

  /**
   * Install a core. coreId e.g. "arduino:avr", "esp32:esp32"
   */
  async coreInstall(coreId) {
    const id = String(coreId || '').trim();
    if (!id) throw new Error('Core ID is required (e.g. arduino:avr or esp32:esp32)');
    return new Promise((resolve, reject) => {
      const args = ['core', 'install', '--format', 'json', id];
      const proc = spawn(this.cliPath, args);
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => {
        if (code === 0) {
          this.coreIndexed = true;
          resolve({ success: true, output: stdout + stderr });
        } else {
          reject(new Error(stderr || stdout || `Core install failed with code ${code}`));
        }
      });
      proc.on('error', err => reject(new Error(`Failed to run: ${err.message}`)));
    });
  }

  /**
   * Uninstall a core. coreId e.g. "arduino:avr", "esp32:esp32"
   */
  async coreUninstall(coreId) {
    const id = String(coreId || '').trim();
    if (!id) throw new Error('Core ID is required');
    const result = await this.runCommand(['core', 'uninstall', id]);
    if (!result.success) {
      throw new Error(result.stderr || result.stdout || 'Core uninstall failed');
    }
    return { success: true };
  }

  /**
   * List example sketches. If libraryName is given, only that library's examples.
   * Returns array of { name, library, path } or similar (path to example folder).
   */
  async libExamples(libraryName = '') {
    const args = ['lib', 'examples'];
    if (libraryName && String(libraryName).trim()) args.push(String(libraryName).trim());
    args.push('--format', 'json');
    const result = await this.runCommand(args);
    if (!result.success) {
      try {
        const text = (result.stdout || result.stderr || '').trim();
        if (!text) return [];
        return this._parseLibExamplesText(text);
      } catch (_) {
        return [];
      }
    }
    try {
      const data = JSON.parse(result.stdout);
      if (Array.isArray(data)) return data;
      if (data.examples && Array.isArray(data.examples)) return data.examples;
      return [];
    } catch (e) {
      return this._parseLibExamplesText(result.stdout || '');
    }
  }

  _parseLibExamplesText(text) {
    const out = [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let currentLib = '';
    for (const line of lines) {
      if (line.includes(' ') && (line.endsWith('.ino') || line.includes('/') || line.includes('\\'))) {
        const path = line.replace(/^[\s\S]*?\s+/, '').trim();
        if (path) out.push({ name: path.split(/[/\\]/).pop() || path, library: currentLib, path });
      } else if (line) {
        currentLib = line;
      }
    }
    return out;
  }

  /**
   * Get all library examples with full paths (using install_dir from lib list + fs).
   * Returns [{ name, library, path }] where path is the example folder.
   */
  async libExamplesWithPaths(libraryFilter = '') {
    const libList = await this.libList();
    const libs = libList.installed_libraries || [];
    const results = [];
    for (const lib of libs) {
      const installDir = lib.install_dir || lib.installDir;
      if (!installDir || (libraryFilter && !lib.name.toLowerCase().includes(String(libraryFilter).toLowerCase()))) continue;
      const examplesDir = path.join(installDir, 'examples');
      try {
        const entries = await fs.readdir(examplesDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory()) {
            const examplePath = path.join(examplesDir, e.name);
            results.push({ name: e.name, library: lib.name, path: examplePath });
          }
        }
      } catch (_) {
        // no examples folder or not readable
      }
    }
    return results.sort((a, b) => (a.library + a.name).localeCompare(b.library + b.name));
  }
}

module.exports = ArduinoService;

