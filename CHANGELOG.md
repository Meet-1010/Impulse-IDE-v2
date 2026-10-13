# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- ESP32 boards run in the simulator: every board of Espressif's ESP32 core built on the ESP32, ESP32-S2, ESP32-S3 or ESP32-C3 (214 boards: DevKits, XIAO, Feather, Heltec, TTGO, LOLIN…) and the Arduino Nano ESP32. The real firmware runs in Espressif's QEMU, compiled for the board you picked with its own pins and options, with Espressif's core 2.x or 3.x. New drawings: ESP32 DevKit V1, ESP32-S3 DevKitC-1 (its RGB LED lights up), ESP32-C3 DevKitM-1 and the Nano ESP32; other boards are drawn on their chip's DevKit and wired by GPIO number, and ESP32-S2 boards (which QEMU doesn't emulate) run on the S3 with their own pin definitions.
  - Pins, buttons and interrupts, analogRead, PWM (analogWrite, LEDC on cores 2.x and 3.x, tone), the RGB LED, pulseIn (ultrasonic sensors) and I²C (Wire) work with the simulator's parts; Serial is the serial pane. A small bridge compiled into the simulated sketch (never into uploads) connects the firmware to the circuit.
  - Wi-Fi: the emulator has no radio, so WiFi.begin() joins a pretend network and gets IP 10.0.2.15, and scans find two networks, so sketches run past their Wi-Fi setup; requests to the internet get no answer.
  - The emulator ships inside the Mac app. On Windows and Linux it downloads from Espressif the first time you simulate an ESP32 (you're asked first; about 4–40 MB), checked against its published checksum; on Linux it uses the system's pixman, libgcrypt, SDL2 and libslirp, and names the packages to install if one is missing.
  - Six ESP32 examples (blink, dimmer, Wi-Fi status light, S3 RGB LED, C3 button interrupt, Nano ESP32 blink), and impulse-test runs ESP32 sketches too (`--fqbn esp32:esp32:…`).

- The AI knows your board instead of guessing. Every request carries the selected board's real facts, read from its installed core the way the compiler sees them: the chip, clock and logic voltage, what LED_BUILTIN really is (a plain LED, an RGB NeoPixel such as the ESP32-S3's on GPIO48, or not defined at all), and the I2C, SPI and Serial pins. Four new agent tools go further:
  - get_board_info: any installed board's pins, analog and touch pins, memory, board options (such as USB CDC On Boot) and traps, from any core.
  - get_mcu_guide: rules for 24 chip families, from the ATmega328P, Mega and Leonardo through megaAVR, ATtiny, SAMD, Renesas (UNO R4), nRF52840, RP2040/RP2350, every ESP32 variant and the ESP8266, to STM32, Teensy and the UNO Q. It covers voltage and current limits, pins to avoid, ADC/PWM/timer behaviour, USB Serial, the ESP32 core 2.x → 3.x API changes, and common mistakes, plus embedded fundamentals.
  - get_component_guide: 65 sensors, displays, drivers and modules with their interface, voltage, I2C addresses, library and wiring pitfalls, found by name or by I2C address.
  - search_boards: any board's FQBN and the core it needs, installed or not.

  When the board changes mid-conversation, the AI is told that earlier answers were for the other board.

### Changed

- Free local models: the model menu offers the ones worth downloading for Impulse that fit the computer's memory, best first, each with what it's good at: Qwen3-Coder 30B and Devstral Small 2 (32 GB and up), Qwen3 14B (24 GB), Qwen3 8B and the code-tuned Rnj-1 8B (16 GB), Qwen3 4B (smaller computers). All of them call tools, which the agent needs.

## [2.0.0-beta.2] - 2026-10-12

### Added

- Stop the AI while it works: a Stop button takes the chat box's place during a turn (Esc does the same). The model call in flight is cancelled with Claude, OpenAI, Gemini and Ollama alike, no further tool runs, and the unfinished turn is left out of the conversation the AI remembers.
- New chat (the pencil in the chat's header) starts a fresh conversation: the AI forgets the old one and the starter suggestions come back. It replaces the button that cleared the screen but kept the context.
- Copy buttons on each answer and on each code block in the chat, and a right-click menu (Cut, Copy, Paste, Select All) wherever text can be edited or is selected.

- Free AI on your own computer with Ollama, no API key: installed models appear in the model menu under "Ollama · free, on this computer", and with no key saved the chat uses one by itself. "Start Ollama…" opens it when it isn't running (or points to the download when it isn't installed), and with no model yet "Download Qwen3…" fetches one sized to the computer, with progress. The agent's tools work with local models that support them, including the ones that write a tool call as JSON text instead of a structured call (Qwen2.5 Coder); thinking models answer directly instead of reasoning at length; a model without tool support answers in text and says so. Ollama is reached at `127.0.0.1:11434`, or at `OLLAMA_HOST`.
- The board you plug in is selected for upload, with its port, and the simulator follows it when it can run it. At launch, a connected board is selected when nothing usable is. A board arduino-cli can't tell apart from others (several ESP32-S3 boards share one USB id) keeps the selected one if it fits, else asks which it is; clones without a USB id change nothing.
- The simulator runs every board built on the chips it emulates: ATmega168 boards (Diecimila, Nano, Pro and Pro Mini 168) on an emulated ATmega168, the Mega 1280 on an ATmega1280, ATtiny25 and ATtiny45 on the ATtiny85 drawing, and the RP2040 boards of the Arduino-Pico core (Seeed XIAO RP2040, Adafruit Feather RP2040, Arduino Nano RP2040 Connect and about 100 more), compiled with their own pin names and drawn as a Pico, wired by GPIO number. Slower variants compile as their 16 MHz twin so timing matches. impulse-test and Compare with Board use the same chips. RP2350 boards and the Pico W are reported as not simulated, and a program built for another chip is refused with a reason instead of misbehaving.

### Fixed

- ⌘C / Ctrl+C copied nothing from the chat: copying only looked at text fields and the code editor, so text selected in an answer was ignored. Selected text anywhere on the page copies now.
- Your messages in the chat had their text against the card's edge; they have room inside the card now.
- The chat box didn't focus when clicked, and the model and mode menus under it were hard to click: the pill's glow, halo and pulse, invisible at rest, reached past it and caught the clicks. Now a click anywhere on the pill types into it, and the menus are full-height targets with a visible arrow.
- Asking the AI to write a sketch with no sketch open reported success while the code went into a hidden editor. The agent is now told there's no editor and shows the code in its answer.
- macOS downloads from GitHub opened as "damaged": the app carried only the Electron binary's signature, which no longer matched the bundle. Builds without a Developer ID are now signed ad hoc, so macOS asks once (System Settings › Privacy & Security › Open Anyway) instead of refusing.

- Saving an API key now makes the AI chat use it straight away (that provider's newest model) instead of waiting for a model to be chosen or a restart. Sending with a key but no model picks one; with no key the chat says where to add one and opens the key settings. The model menu groups models by provider and marks the ones without a key, and the line under the chat names the model in use.
- Gemini: the model list is current (Gemini 3.8 Flash first, 3.1 Pro preview and the other Gemini 3 models; the shut-down 1.5 and 2.0 models are gone). Agent tool calls replay Gemini 3's thought signatures, Gemini 3 keeps its default temperature, and a model a key can't use says to pick another.

## [2.0.0-beta.1] - 2026-10-12

### Added

- The AI chat's composer is a glowing pill. On send it folds into a ball, flies up into the conversation and becomes a dotted orb whose label follows what the agent is doing (reading the sketch, writing code, compiling, uploading…), then turns green, condenses and unfolds into the answer card, which stays in the chat. Errors resolve red with "Couldn't finish". It follows the light and dark themes and, with reduced motion, cross-fades instead of moving. The agent now reports each step to the chat as it happens.
- ATtiny85 in the simulator: ATTinyCore firmware runs on an emulated ATtiny85 at 16 MHz, drawn as a DIP-8 chip that plugs across a breadboard. Digital pins PB0–PB5, PWM on PB0 (Timer0) and PB1/PB4 (Timer/Counter1, modelled from the datasheet's fast PWM), the 4-channel ADC with its 1.1 V and 2.56 V references, INT0 and pin-change interrupts, EEPROM and the watchdog. ATTinyCore's software Serial is decoded from PB0 at whatever baud the sketch uses, and typed text goes in on PB1 through the analog comparator interrupt, half duplex like the real chip. The USI is modelled from the datasheet, so Wire (I²C: LCDs, RTCs, sensors) and SPI work on PB0–PB2, and the editor warns when a sketch uses Serial and I²C, which share PB0. The debugger works on it. The circuit check asks for a 2.7–5.5 V supply and warns about PB5 being the RESET pin. The first ATtiny85 build offers to install ATTinyCore (about 10 MB). Three examples (blink, a dimmer, an I²C LCD), and impulse-test runs ATtiny85 sketches too.
- Source Control panel (View › Source Control, ⌘/Ctrl+Shift+G): start a Git repository with a .gitignore for build output, see changed files and their diffs, commit everything, pull (fast-forward only) and push, and browse recent commits. It asks for a name and email once per repository instead of letting git invent one from the computer's name.
- Raspberry Pi Pico in the simulator: Arduino-Pico firmware runs on an emulated RP2040 (rp2040js) with GPIO, PWM, the ADC, I²C, SPI, Serial over USB and Serial1/2, at 3.3 V logic with pull-ups and pull-downs. Every simulated part works with it; the circuit check flags 5 V signals into its pins. The first Pico build offers to install the Arduino-Pico core (about 450 MB). Switching between an Uno and a Pico keeps wires on the matching pins. Two Pico examples, and impulse-test runs Pico sketches too. The debugger stays AVR-only for now.
- Capacitors charge and discharge in simulated time: RC delays, button debouncing, PWM smoothed into a voltage, and analogRead along the charging curve all behave like the real circuit (within about 1% of the RC formula in the tests). The inspector shows the voltage across each capacitor, and a new example plots the RC curve.
- PlatformIO projects: a folder with platformio.ini is built and uploaded with PlatformIO Core. Choose the environment in the status bar; Arduino-framework environments for the Uno, Nano and Mega 2560 can be simulated, debugged and tested like sketches, with diagram.json at the project root.
- Debugger for the simulated Uno, Nano and Mega: breakpoints in the editor gutter, step over/into/out, run to cursor, the call stack (unwound from the compiler's frame information, with each frame's locals), and the values of locals, globals and registers in a Debug tab, with changed values highlighted. Debug › Start Debugging (F5). Debug builds are compiled with -Og and without link-time optimization so every line can be stopped on.
- `impulse-test`: hardware tests on the command line and in CI. It compiles each sketch, simulates it with its `diagram.json` circuit, checks its `// @expect` lines, fails on short circuits, and writes human, JSON or JUnit reports with exit codes for CI. Releases include it as a single file that needs only Node.js and arduino-cli (docs/TESTING.md).
- First-run setup: when arduino-cli, the AVR core or (on Apple silicon) Rosetta is missing, Impulse explains what's needed and installs it with progress. arduino-cli 1.5.1 is downloaded from its official release and checked against a SHA-256 built into the app. Existing installs, including the one inside Arduino IDE 2, are found and used. Tools › Set Up Arduino Tools reruns it.
- Release pipeline: pushing a version tag builds macOS (Intel and Apple silicon), Windows and Linux installers with auto-update metadata into a draft GitHub Release; signing and notarization run when the certificates are configured.
- PRIVACY.md, SECURITY.md (private vulnerability reporting), CONTRIBUTING.md, THIRD_PARTY_NOTICES.md (`npm run notices`), Dependabot, and issue forms for bugs, features and part requests. Privacy and open-source licenses are readable in Help › About.
- `npm run test:e2e`: opens an example, compiles and runs it, presses its button, and audits accessibility (axe) on the main screens in both themes; runs in CI on all three systems.
- Keyboard and screen-reader access in the simulator: `[` and `]` select parts, the selection is announced, and part settings are labelled controls in the inspector. The part picker follows the combobox pattern.
- Help › Report a Problem: review exactly what will be sent (version, OS, recent errors with your home folder and keys removed), then open a pre-filled GitHub issue. Nothing is sent from the app itself.
- Crash recovery: a crashed window offers to reload, and the next launch offers to report what happened.
- "Request this part" in the part picker when a search finds nothing.
- Board options (Tools › Board Options, or the board menu): USB CDC On Boot, flash size, PSRAM, CPU speed and the rest, saved per board and used for verify, upload, export and the AI tools. An ESP32 on its built-in USB port gets "USB CDC On Boot" turned on automatically so its Serial output shows up.
- The Serial Monitor reopens by itself after an upload, as in Arduino IDE 2.
- Port lists name the USB chip when the board isn't recognised (Espressif native USB, CH340, CP210x, FTDI…) and list USB ports first; Bluetooth and system ports appear under "Show all ports".
- Simulator boards: Arduino Nano and Arduino Mega 2560 (ATmega2560: ports A–L, timers 0–5, Serial1–3, 16 analog inputs) alongside the Uno; switching boards keeps wires on matching pins.
- Circuit engine with real nets and voltages: pull-ups, voltage dividers, breadboards (full, half, mini), short-circuit detection, and parts that react to each other as well as to the Arduino.
- 90 simulated parts (4 of them boards), including LCD 16×2/20×4 (I²C and parallel), SSD1306, ILI9341, NeoPixels, MAX7219, TM1637, HC-SR04, DHT11/22, DS18B20, MPU6050, DS1307, HX711, keypads, KY-040, IR remote, servos, steppers (NEMA 17, 28BYJ-48 + ULN2003, A4988), L293D, L298N, relays, 74HC595, NPN and MOSFET transistors, diodes, capacitors, batteries, logic gates and a D flip-flop.
- Part picker with search, categories, thumbnails and drag-to-place; advice when a part or board isn't simulated.
- Inspector with live controls (distance, temperature, light…), pin documentation, wiring and library install.
- 39 example projects (Sketch + circuit) in a searchable gallery, each compiled and simulated by the test suite.
- Circuit check tab; `diagram.json` saved with each sketch; Wokwi diagram import/export; undo/redo, copy/paste, rotate, multi-select.
- Serial pane with line endings and Serial1–3 on the Mega; buzzers play through the speakers (mutable).
- Hardware tests: `// @expect` and `// @run` comments checked by a headless simulator run (Sketch › Run Hardware Tests).
- AI code edits are verified in the simulator automatically, with a pass/fail card and "Fix with AI".
- Pin-aware editor: wiring on hover, gutter warnings for common pin mistakes and wiring mismatches.
- Logic analyzer tab in the simulator.
- Compare Simulator with Board: serial output diff between the simulator and a real Uno, Nano or Mega.
- Real implementations of Open Recent, Export Compiled Binary, Archive Sketch, Upload Using Programmer, Get Board Info, Add File, Preferences, Find/Replace and Go to Line.
- Arduino syntax mode, status bar, in-app dialogs, design system (dark default), bundled fonts, app icon.
- Smoke test (`npm run test:smoke`), IPC contract test, simulator tests; CI on macOS, Linux and Windows.

### Changed

- Secondary text and status colors meet WCAG AA contrast (4.5:1) in both themes.
- Beta builds update to newer betas; stable builds only to stable releases.
- The app is Impulse IDE 2.0.0-beta.1; updates and problem reports go to github.com/Meet-1010/Impulse-IDE-v2. Data from pre-2.0 development builds (`arduino-ide-cursor`) keeps being used, so nothing resets. AI keys saved by those builds may need to be entered once more.
- `package-lock.json` is committed for reproducible installs; CI compiles and simulates every example on Linux with pinned library versions.
- Installers no longer carry renderer-only packages that are already bundled.
- Claude provider: Opus 5.5 / Sonnet 5.5 / Fable 5.1 / Haiku 4.5, effort per mode, streaming, refusal and truncation handling, server-side fallbacks.
- API keys moved to the OS credential store; keys from the old store are migrated once.
- File access is denied by default; folder approvals persist in the main process.
- Keyboard shortcuts come only from the application menu (⌘ on macOS, no double firing).
- Removed the unused terminal, plugin and collaboration services and their dependencies.
- User data (memory, plugins, error memory, AI DB) now uses Electron `app.getPath('userData')` when available for correct paths on clean/portable installs.
- CI: tests + lint on Ubuntu and Windows; separate job builds Windows installer and uploads artifact.

### Fixed

- Code blocks in chat answers drew a second frame inside their own, and left a blank line after them.
- The end-to-end test audits the first-run welcome toast once it has fully appeared, then skips the tour; on a slow runner a later audit could catch it half faded and report its contrast. The toast's × button is labelled "Dismiss".
- The sidebar Debug panel was a placeholder whose start button only printed a hint about launch.json. It now starts the simulator's debugger and lists the breakpoints.
- Saving (⌘S, autosave, or the save before Verify, Upload and simulating) while a second tab of a sketch was open wrote that tab's text over the sketch's .ino. Each tab is now saved to its own file, and every edited tab is saved before a build, so builds never use stale headers. The AI agent no longer writes the sketch into whichever tab is showing.
- The end-to-end and smoke tests refuse to run when their debugging port is taken, instead of driving whichever app holds it.
- Loading the simulator outside the app pulled in every part element just for the LCD font, and touched `localStorage` (a warning in Node 25+).
- Accessibility: wrong ARIA roles on the activity bar, file list, editor tabs and dialogs; unlabelled AI and editor controls; nested interactive elements in tabs and part thumbnails; logs that couldn't be scrolled from the keyboard.
- The welcome tour waited for nothing and appeared on top of first-run setup.
- ESP32-S3/C3/C6 boards on their built-in USB port printed nothing to the Serial Monitor (USB CDC On Boot couldn't be set).
- The Serial Monitor log grew without limit; it keeps the latest 5,000 lines.
- CI failed before running anything because the lockfile was ignored.
- A critical advisory in a development dependency (`shell-quote`, via `concurrently`).
- Simulator: live speed dropped to about half real time with the logic analyzer recording busy pins; status lines no longer split a half-printed serial line; installed libraries were reported as missing.
- Choosing newer Claude models failed because `temperature` was always sent.
- API keys were wiped whenever the Mac's hostname changed.
- Tooltip and keyboard-navigation crashes; Auto Format adding an indent level on every press; Save reporting success on failure; the simulator running unsaved code; compile failures reported as success.
- Go to Line, Find and Add Tab were broken (`prompt()` is unavailable in Electron).
- Fresh `npm install` failed under npm 11 (native rebuild step); dependency audit findings.
- Production prep: SimpleMemory/recordExecution fix, portable paths, code signing docs, CI build exe, changelog.
- **SimpleMemory.recordExecution** now uses the same signature as AIMemory (`toolCall`, `result`) so default memory behavior is correct when tools run.
- Sidebar collapse now works after resizing (inline width cleared when toggling collapse); drag-to-collapse via resizer.
- CodeMirror load: shared ref and init-order fix so the editor loads reliably in the packaged app.

## [1.0.0] - (prior to changelog)

- Initial Impulse IDE release: compile, upload, serial monitor, AI assistant, error memory, modern UI.

[Unreleased]: https://github.com/Meet-1010/Impulse-IDE-v2/compare/v2.0.0-beta.1...HEAD
[2.0.0-beta.1]: https://github.com/Meet-1010/Impulse-IDE-v2/releases/tag/v2.0.0-beta.1
[1.0.0]: https://github.com/nate1029/Impulse/releases/tag/v1.0.0
