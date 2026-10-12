/**
 * Tool Schema Definitions
 * Structured tool instructions that the AI Agent can output
 */

const TOOL_SCHEMA = {
  // Arduino Operations
  COMPILE_SKETCH: {
    name: 'compile_sketch',
    description: 'Compile an Arduino sketch using Arduino CLI. If sketchPath or boardFQBN are omitted, uses the currently open sketch and selected board from the IDE.',
    parameters: {
      type: 'object',
      properties: {
        sketchPath: {
          type: 'string',
          description: 'Full path to the .ino sketch file. Optional: uses currently open sketch if omitted.'
        },
        boardFQBN: {
          type: 'string',
          description: 'Fully Qualified Board Name (e.g., arduino:avr:uno). Optional: uses selected board if omitted.'
        }
      },
      required: []
    }
  },

  UPLOAD_SKETCH: {
    name: 'upload_sketch',
    description: 'Upload compiled code to an Arduino board. If sketchPath, boardFQBN, or port are omitted, uses the currently open sketch, selected board, and selected port from the IDE.',
    parameters: {
      type: 'object',
      properties: {
        sketchPath: {
          type: 'string',
          description: 'Full path to the .ino sketch file. Optional: uses currently open sketch if omitted.'
        },
        boardFQBN: {
          type: 'string',
          description: 'Fully Qualified Board Name. Optional: uses selected board if omitted.'
        },
        port: {
          type: 'string',
          description: 'Serial port (e.g., COM3, /dev/ttyUSB0). Optional: uses selected port if omitted.'
        }
      },
      required: []
    }
  },

  LIST_BOARDS: {
    name: 'list_boards',
    description: 'List all available Arduino boards',
    parameters: {
      type: 'object',
      properties: {}
    }
  },

  LIST_PORTS: {
    name: 'list_ports',
    description: 'List all available serial ports',
    parameters: {
      type: 'object',
      properties: {}
    }
  },

  // Serial Monitor Operations
  CONNECT_SERIAL: {
    name: 'connect_serial',
    description: 'Connect to a serial port for monitoring',
    parameters: {
      type: 'object',
      properties: {
        port: {
          type: 'string',
          description: 'Serial port path'
        },
        baudRate: {
          type: 'number',
          description: 'Baud rate (common: 9600, 115200)',
          default: 115200
        }
      },
      required: ['port']
    }
  },

  DISCONNECT_SERIAL: {
    name: 'disconnect_serial',
    description: 'Disconnect from serial port',
    parameters: {
      type: 'object',
      properties: {}
    }
  },

  SEND_SERIAL: {
    name: 'send_serial',
    description: 'Send data to the connected serial port',
    parameters: {
      type: 'object',
      properties: {
        data: {
          type: 'string',
          description: 'Data to send'
        }
      },
      required: ['data']
    }
  },

  READ_SERIAL: {
    name: 'read_serial',
    description: 'Read recent serial monitor output',
    parameters: {
      type: 'object',
      properties: {
        lines: {
          type: 'number',
          description: 'Number of recent lines to read',
          default: 50
        }
      }
    }
  },

  AUTO_DETECT_BAUD: {
    name: 'auto_detect_baud',
    description: 'Automatically detect the correct baud rate for a serial port',
    parameters: {
      type: 'object',
      properties: {
        port: {
          type: 'string',
          description: 'Serial port path'
        }
      },
      required: ['port']
    }
  },

  // Baud Rate Operations
  GET_BAUD_RATE: {
    name: 'get_baud_rate',
    description: 'Get the current baud rate setting for serial communication',
    parameters: {
      type: 'object',
      properties: {}
    }
  },

  SET_BAUD_RATE: {
    name: 'set_baud_rate',
    description: 'Set the baud rate for serial communication. Common rates: 300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000, 500000, 1000000, 2000000',
    parameters: {
      type: 'object',
      properties: {
        baudRate: {
          type: 'number',
          description: 'The baud rate to set (e.g., 9600, 115200)'
        }
      },
      required: ['baudRate']
    }
  },

  GET_AVAILABLE_BAUD_RATES: {
    name: 'get_available_baud_rates',
    description: 'Get list of all available baud rate options',
    parameters: {
      type: 'object',
      properties: {}
    }
  },

  // Code Editor Operations
  GET_EDITOR_CODE: {
    name: 'get_editor_code',
    description: 'Get the current code content from the editor. If the result is empty or whitespace-only, the user has no code yet—use set_editor_code to write code when they ask for it.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },

  SET_EDITOR_CODE: {
    name: 'set_editor_code',
    description: 'Replace the entire code content in the editor. Use when the editor is empty and the user asks for code, or after confirming replacement of existing code.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The new code to set in the editor'
        }
      },
      required: ['code']
    }
  },

  EDIT_CODE: {
    name: 'edit_code',
    description: 'Edit specific lines or sections of code in the editor. Can insert, replace, or delete code.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description: 'Operation type: "replace", "insert", or "delete"',
          enum: ['replace', 'insert', 'delete']
        },
        startLine: {
          type: 'number',
          description: 'Starting line number (1-indexed)'
        },
        endLine: {
          type: 'number',
          description: 'Ending line number (1-indexed, inclusive). For insert, this is ignored.'
        },
        newCode: {
          type: 'string',
          description: 'New code to insert or replace with. Not needed for delete.'
        }
      },
      required: ['operation', 'startLine']
    }
  },

  SEARCH_CODE: {
    name: 'search_code',
    description: 'Search for text or patterns in the current editor code',
    parameters: {
      type: 'object',
      properties: {
        searchText: {
          type: 'string',
          description: 'Text or regex pattern to search for'
        },
        isRegex: {
          type: 'boolean',
          description: 'Whether to treat searchText as a regex pattern',
          default: false
        }
      },
      required: ['searchText']
    }
  },

  REPLACE_IN_CODE: {
    name: 'replace_in_code',
    description: 'Find and replace text in the editor code',
    parameters: {
      type: 'object',
      properties: {
        searchText: {
          type: 'string',
          description: 'Text to find'
        },
        replaceText: {
          type: 'string',
          description: 'Text to replace with'
        },
        replaceAll: {
          type: 'boolean',
          description: 'Replace all occurrences or just the first',
          default: false
        }
      },
      required: ['searchText', 'replaceText']
    }
  },

  GET_CURRENT_SKETCH_PATH: {
    name: 'get_current_sketch_path',
    description: 'Get the file path of the currently open sketch',
    parameters: {
      type: 'object',
      properties: {}
    }
  },

  SAVE_SKETCH: {
    name: 'save_sketch',
    description: 'Save the current editor content to the sketch file',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional file path. If not provided, saves to current sketch path.'
        }
      }
    }
  },

  // Analysis Operations
  ANALYZE_ERROR: {
    name: 'analyze_error',
    description: 'Analyze an error message and suggest fixes',
    parameters: {
      type: 'object',
      properties: {
        errorMessage: {
          type: 'string',
          description: 'The error message to analyze'
        },
        context: {
          type: 'object',
          description: 'Additional context (sketch path, board type, etc.)'
        }
      },
      required: ['errorMessage']
    }
  },

  SEARCH_MEMORY: {
    name: 'search_memory',
    description: 'Search the error memory database for similar past errors',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Error message or pattern to search for'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results',
          default: 10
        }
      },
      required: ['query']
    }
  },

  RECORD_FIX: {
    name: 'record_fix',
    description: 'Record a successful fix to the memory database',
    parameters: {
      type: 'object',
      properties: {
        errorSignature: {
          type: 'string',
          description: 'Signature/pattern of the error'
        },
        fix: {
          type: 'string',
          description: 'The fix that resolved the error'
        },
        context: {
          type: 'object',
          description: 'Additional context (board, sketch, etc.)'
        }
      },
      required: ['errorSignature', 'fix']
    }
  },

  // Board and hardware knowledge
  GET_BOARD_INFO: {
    name: 'get_board_info',
    description: 'Real facts about the selected board (or the board given), read from its installed Arduino core: chip, clock, flash and RAM, LED_BUILTIN and any RGB LED (with how to drive it), I2C/SPI/Serial pins, analog pins, board options (e.g. USB CDC On Boot) and notes on traps. Call it before writing code that depends on a pin.',
    parameters: {
      type: 'object',
      properties: {
        fqbn: { type: 'string', description: 'Board FQBN such as arduino:avr:uno or esp32:esp32:esp32s3. Optional: the selected board when omitted.' },
        raw: { type: 'boolean', description: 'Also list every pin definition as written in the core (long).' }
      }
    }
  },

  GET_MCU_GUIDE: {
    name: 'get_mcu_guide',
    description: 'Rules for a microcontroller family: voltage and per-pin current limits, pins to avoid (strapping, flash, input-only), ADC/DAC/PWM/timer behaviour, interrupts, USB Serial, core API changes (e.g. ESP32 core 2.x vs 3.x) and common mistakes, plus embedded fundamentals.',
    parameters: {
      type: 'object',
      properties: {
        chip: { type: 'string', description: 'A family or chip, e.g. "esp32-s3", "esp32", "esp8266", "atmega328p", "atmega2560", "atmega32u4", "rp2040", "samd21", "renesas-ra4m1", "nrf52840", "attiny-x5", "stm32", or "general". Optional: the selected board\'s chip when omitted.' },
        fqbn: { type: 'string', description: 'A board FQBN instead of a chip name.' }
      }
    }
  },

  GET_COMPONENT_GUIDE: {
    name: 'get_component_guide',
    description: 'How to use a sensor, display, motor, driver or module with an Arduino-compatible board: interface, supply and logic voltage, I2C address(es), the library to use, wiring and the mistakes that make it not work.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, part number or I2C address, e.g. "SSD1306", "DHT22", "HC-SR04", "A4988", "WS2812B", "0x27".' }
      },
      required: ['query']
    }
  },

  SEARCH_BOARDS: {
    name: 'search_boards',
    description: 'Find boards by name across the installed cores and every core in the Boards Manager index. Returns each board\'s FQBN when its core is installed, and the core to install when it isn\'t.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Board name or part of it, e.g. "uno r4", "xiao", "esp32-c3", "pico 2".' }
      },
      required: ['query']
    }
  },

  // Get Current State
  GET_CURRENT_STATE: {
    name: 'get_current_state',
    description: 'Get the current application state including selected board, port, baud rate, serial connection status, and open sketch path',
    parameters: {
      type: 'object',
      properties: {}
    }
  },

  // Playground — hardware task instructions
  UPDATE_PLAYGROUND: {
    name: 'update_playground',
    description: 'Display hardware instructions in the Playground tab. Use this to tell the user what physical steps to perform: wiring, component placement, connections, circuit setup, breadboard layout, pin mapping, etc. Content is shown as text in the Playground panel at the bottom of the IDE.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The hardware instructions or task description to display. Can include wiring steps, pin connections, component lists, or any physical setup instructions.'
        },
        append: {
          type: 'boolean',
          description: 'If true (default), appends to existing playground content. If false, replaces all existing content.'
        }
      },
      required: ['content']
    }
  }
};

const DEBUG_TOOL_NAMES = ['analyze_error', 'search_memory', 'record_fix'];

/**
 * Get all available tools as an array
 */
function getAllTools() {
  return Object.values(TOOL_SCHEMA);
}

/**
 * Get tools for debug mode (analysis and memory only)
 */
function getDebugTools() {
  return Object.values(TOOL_SCHEMA).filter(t => DEBUG_TOOL_NAMES.includes(t.name));
}

/**
 * Get tool by name
 */
function getTool(name) {
  return Object.values(TOOL_SCHEMA).find(tool => tool.name === name);
}

/**
 * Validate tool call structure
 */
const JSON_TYPES = {
  string: v => typeof v === 'string',
  number: v => typeof v === 'number' && Number.isFinite(v),
  integer: v => Number.isInteger(v),
  boolean: v => typeof v === 'boolean',
  array: v => Array.isArray(v),
  object: v => v !== null && typeof v === 'object' && !Array.isArray(v)
};

/**
 * Validate a model-produced tool call against the tool's JSON schema
 * (required fields, primitive types, enums). Model output is untrusted, and
 * streamed tool inputs can arrive truncated.
 */
function validateToolCall(toolCall) {
  if (!toolCall || !toolCall.name) {
    return { valid: false, error: 'Tool name is required' };
  }

  const tool = getTool(toolCall.name);
  if (!tool) {
    return { valid: false, error: `Unknown tool: ${toolCall.name}` };
  }

  const args = toolCall.arguments ?? {};
  if (!JSON_TYPES.object(args)) {
    return { valid: false, error: `Arguments for ${toolCall.name} must be an object` };
  }

  for (const param of tool.parameters.required || []) {
    if (args[param] === undefined || args[param] === null) {
      return { valid: false, error: `Missing required parameter: ${param}` };
    }
  }

  const props = tool.parameters.properties || {};
  for (const [key, value] of Object.entries(args)) {
    const spec = props[key];
    if (!spec || value === undefined || value === null) continue;
    const types = Array.isArray(spec.type) ? spec.type : (spec.type ? [spec.type] : []);
    if (types.length && !types.some(t => JSON_TYPES[t] ? JSON_TYPES[t](value) : true)) {
      return { valid: false, error: `Parameter "${key}" must be ${types.join(' or ')}` };
    }
    if (Array.isArray(spec.enum) && !spec.enum.includes(value)) {
      return { valid: false, error: `Parameter "${key}" must be one of: ${spec.enum.join(', ')}` };
    }
  }

  return { valid: true };
}

module.exports = {
  TOOL_SCHEMA,
  getAllTools,
  getDebugTools,
  getTool,
  validateToolCall
};
