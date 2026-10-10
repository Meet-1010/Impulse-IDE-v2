
# Impulse IDE - Architecture

## Overview

Impulse is an **AI-assisted IDE for Arduino development with a built-in circuit simulator**. It provides an intelligent coding environment with AI assistance, serial monitoring, and seamless Arduino CLI integration.

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Impulse IDE                               │
├──────────────┬─────────────────────────────┬───────────────────────┤
│   Sidebar    │      Code Editor            │    AI Assistant       │
│              │                             │                       │
│ • Open File  │  • Syntax highlighting      │ • Natural language    │
│ • Board      │  • Line numbers             │ • Multi-model         │
│ • Port       │  • Auto-complete            │ • Tool execution      │
│ • Verify     │                             │ • Error analysis      │
│ • Upload     │                             │                       │
│              ├─────────────────────────────┤                       │
│ • Serial     │      Output Panel           │                       │
│              │  • Console                  │                       │
│              │  • Serial Monitor           │                       │
│              │  • Problems                 │                       │
└──────────────┴─────────────────────────────┴───────────────────────┘
```

## Tech Stack

- **Electron** - Desktop application framework
- **Arduino CLI** - Compile & upload (no IDE modification)
- **CodeMirror** - Code editor with syntax highlighting
- **SerialPort** - Serial communication
- **OpenAI/Gemini/Claude** - AI providers

## Directory Structure

```
src/
├── main/                           # Electron Main Process
│   ├── main.js                     # Entry point, IPC handlers
│   ├── preload.js                  # Secure bridge to renderer
│   └── services/
│       ├── arduinoService.js       # Arduino CLI operations
│       ├── serialMonitor.js        # Serial port communication
│       ├── errorMemory.js          # Legacy error tracking
│       └── ai/
│           ├── agent.js            # AI orchestrator
│           ├── providers/          # LLM adapters
│           │   ├── baseProvider.js
│           │   ├── openaiProvider.js
│           │   ├── geminiProvider.js
│           │   └── claudeProvider.js
│           ├── tools/              # Tool system
│           │   ├── toolSchema.js   # Tool definitions
│           │   └── toolExecutor.js # Tool execution
│           ├── memory/
│           │   └── simpleMemory.js # JSON-based memory
│           ├── prompts/
│           │   └── systemPrompt.js
│           └── config/
│               └── apiKeyManager.js
│
└── renderer/                       # Electron Renderer (UI)
    ├── index.html                  # Main HTML
    ├── styles.css                  # CSS styles
    └── renderer.js                 # UI logic
```

## Core Components

### 1. Arduino Service (`arduinoService.js`)

Handles all Arduino CLI operations:

```javascript
// Key methods
checkCLI()              // Verify CLI installed
listBoards()            // Get available boards (JSON)
listPorts()             // Get connected ports (JSON)
compile(sketch, fqbn)   // Compile sketch
upload(sketch, fqbn, port) // Upload to board
```

**FQBN Format**: `vendor:architecture:board`
- Example: `arduino:avr:uno`
- Validated before compile/upload

### 2. Serial Monitor (`serialMonitor.js`)

Real-time serial communication:

```javascript
connect(port, baudRate)  // Open connection
disconnect()             // Close connection
send(data)               // Send data
// Events: 'data', 'connected', 'disconnected', 'error'
```

### 3. AI Agent (`ai/agent.js`)

Orchestrates AI interactions:

```javascript
setProvider(name, apiKey, model)  // Configure LLM
processQuery(query, context)       // Process user input
analyzeError(error, context)       // Analyze errors
```

**Conversation Flow**:
1. User sends message
2. Agent builds context (sketch, board, port, code)
3. LLM processes with tool definitions
4. Tool calls executed by ToolExecutor
5. Results returned to user

### 4. Tool System (`ai/tools/`)

**Available Tools**:
| Tool | Description |
|------|-------------|
| `compile_sketch` | Compile Arduino sketch |
| `upload_sketch` | Upload to board |
| `list_boards` | List available boards |
| `list_ports` | List connected ports |
| `connect_serial` | Open serial monitor |
| `disconnect_serial` | Close serial |
| `send_serial` | Send data |
| `read_serial` | Read recent output |
| `analyze_error` | Analyze error message |
| `search_memory` | Search past errors |
| `record_fix` | Save successful fix |

### 5. Memory System (`ai/memory/simpleMemory.js`)

JSON-based persistence (no SQLite dependency):

```json
{
  "errors": [{ "signature": "...", "message": "...", "count": 1 }],
  "fixes": [{ "errorSignature": "...", "description": "..." }],
  "executions": [{ "tool": "...", "success": true }]
}
```

Stored at: `<userData>/memory.json` (`Impulse IDE`, or `arduino-ide-cursor` for data from pre-2.0 development builds)

### 6. API Key Manager (`ai/config/apiKeyManager.js`)

Secure API key storage using `electron-store`:
- Encrypted storage
- Per-provider keys
- Format validation

## Simulator (`src/renderer/simulation/`)

The simulator runs the sketch's compiled firmware on an emulated AVR and wires it to parts on a canvas.

```
arduino-cli compile ──► app .hex ──► AvrRunner (avr8js) ◄──► CircuitEngine ◄──► part behaviors ──► canvas elements
                                       │ ports, timers, USART,     │ nets, voltages,      │ LEDs, LCDs, sensors,
                                       │ ADC, TWI, SPI, EEPROM     │ edges, I²C/SPI       │ motors, gates…
```

| Module | Role |
|---|---|
| `mcu.js`, `boards.js` | ATmega328P / ATmega2560 descriptions and the Uno, Nano and Mega 2560 pin maps (PWM, analog, I²C, SPI, serial, interrupts). |
| `avr-runner.js` | Runs the CPU in real time (12 ms budget per frame), exposes pin states, ADC voltages, an I²C bus and an SPI bus, keeps EEPROM per board, handles the watchdog and RESET. |
| `netlist.js` | Union-find nets plus nodal analysis per resistive island: pull-ups, voltage dividers, shorts. |
| `engine.js` | Builds nets from wires, breadboard plugs and part internals; resolves every input pin; measures PWM duty and frequency; routes Arduino pin edges to `onPin` and any net level change to `onNet` (so gates can feed gates). |
| `parts/catalog.js` | Every part: label, category, search keywords, description, pins, editable props, live controls, libraries, behavior, Wokwi aliases. `parts/pins.js` holds pin positions captured from the rendered elements for headless use. |
| `parts/*.js`, `devices/*.js` | Behaviors (basic, displays, input, sensors, motion, power, logic, modules) and protocol models (HD44780, SSD1306, ILI9341, WS2812, DHT, DS18B20 1-Wire, TM1637, MAX7219/74HC595, NEC IR, DS1307/MPU6050 registers). |
| `elements/` | Custom elements for parts not in `@wokwi/elements` (breadboards, chips, gates, modules), drawn in millimetres on the 0.1" grid. |
| `canvas.js` | Wiring canvas: placement, rotation, wiring with waypoints, breadboard plugging, selection, zoom. |
| `diagram.js` | Wokwi-compatible `diagram.json` read/write, routing hints, breadboard plug detection. |
| `search.js`, `ui/` | Part picker (search with typo tolerance, synonyms and advice for things that aren't simulated), inspector, examples gallery. |
| `examples.js` | Example projects (sketch + circuit); each is compiled and run by the test suite. |
| `headless.js`, `expectations.js` | Runs firmware without a DOM for hardware tests (`// @expect …`) and AI verification. |
| `index.js` | `SimulationManager`: toolbar, board switching, persistence (diagram.json next to the sketch), circuit checks, serial pane, logic analyzer, AI circuit builder and agent loop. |

Circuits are saved as `diagram.json` beside the sketch. Opening an example writes the sketch and its diagram to `<sketchbook>/Impulse Examples/<name>/`.

## Data Flow

### Compile Flow
```
User clicks "Verify"
      ↓
renderer.js: compileSketch()
      ↓
IPC: 'arduino:compile'
      ↓
main.js → arduinoService.compile()
      ↓
arduino-cli compile --fqbn xxx
      ↓
Result → renderer
      ↓
Display in console/problems
```

### AI Query Flow
```
User sends message
      ↓
renderer.js: sendAIMessage()
      ↓
IPC: 'ai:process-query'
      ↓
agent.js → Provider (OpenAI/Gemini/Claude)
      ↓
LLM returns tool calls
      ↓
toolExecutor.execute() → arduinoService/serialMonitor
      ↓
Results → LLM → Final response
      ↓
Display in AI panel
```

## IPC Channels

### Arduino
- `arduino:compile` - Compile sketch
- `arduino:upload` - Upload to board
- `arduino:list-boards` - Get boards
- `arduino:list-ports` - Get ports
- `arduino:check-cli` - Check CLI status

### Serial
- `serial:connect` - Open port
- `serial:disconnect` - Close port
- `serial:send` - Send data
- `serial:list-ports` - List ports
- `serial:data` (event) - Incoming data

### Simulator
- `arduino:compile-hex` - Compile for a simulated board and return the application HEX
- `sketch:create-example` - Write an example sketch and its `diagram.json` into the sketchbook
- `dialog:open-diagram` / `dialog:save-diagram` - Import and export circuits
- `ai:generate-circuit` - Build a circuit for the current sketch
- `ai:verify-execution` - Judge a simulated run (board, wiring, serial, pins) and propose a fix

### AI
- `ai:set-provider` - Configure AI
- `ai:process-query` - Send query
- `ai:analyze-error` - Analyze error
- `api-keys:set/get/has` - Key management

## UI Components

### Sidebar
- File selection
- Board dropdown (populated from CLI)
- Port dropdown (auto-detected)
- Verify/Upload buttons
- Serial controls

### Code Editor
- CodeMirror with C/C++ syntax
- Dark theme (Dracula)
- Line numbers
- Bracket matching

### Output Panel
- **Console**: Build output, logs
- **Serial Monitor**: Real-time data
- **Problems**: Errors with suggestions

### AI Panel
- Provider selector
- Chat interface
- Tool execution feedback

## Configuration

### package.json Dependencies
```json
{
  "electron": "^27.0.0",
  "serialport": "^12.0.0",
  "openai": "^4.20.0",
  "@anthropic-ai/sdk": "^0.20.0",
  "@google/generative-ai": "^0.2.1",
  "electron-store": "^8.1.0"
}
```

### Build Configuration
```json
{
  "build": {
    "appId": "com.arduinoidecursor.app",
    "productName": "Impulse IDE",
    "win": { "target": "nsis" }
  }
}
```

## Error Handling

1. **FQBN Validation**: Ensures format `vendor:arch:board`
2. **Port Detection**: Falls back to empty list
3. **Board List**: Provides defaults if CLI fails
4. **AI Errors**: Graceful fallback messages
5. **Memory Errors**: Operations continue without persistence

## Security

- Context isolation enabled
- No direct Node.js in renderer
- Preload bridge for IPC
- Encrypted API key storage
- No shell injection (validated inputs)

## Getting Started

1. Install Arduino CLI
2. `npm install`
3. `npm start`
4. Select board and port
5. Open sketch
6. Verify/Upload
7. Use AI for help

## Future Improvements

- [ ] Multiple file support
- [ ] Library manager
- [ ] Board manager
- [ ] Git integration
- [ ] Sketch templates
- [ ] Auto-complete for Arduino
- [ ] Live error detection

