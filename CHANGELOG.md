# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

### Fixed

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

### Fixed

- **SimpleMemory.recordExecution** now uses the same signature as AIMemory (`toolCall`, `result`) so default memory behavior is correct when tools run.
- Sidebar collapse now works after resizing (inline width cleared when toggling collapse); drag-to-collapse via resizer.
- CodeMirror load: shared ref and init-order fix so the editor loads reliably in the packaged app.

### Changed

- User data (memory, plugins, error memory, AI DB) now uses Electron `app.getPath('userData')` when available for correct paths on clean/portable installs.
- CI: tests + lint on Ubuntu and Windows; separate job builds Windows installer and uploads artifact.

## [1.0.0] - (prior to changelog)

- Initial Impulse IDE release: compile, upload, serial monitor, AI assistant, error memory, modern UI.

[Unreleased]: https://github.com/Meet-1010/Impulse-IDE-v2/compare/v2.0.0-beta.1...HEAD
[1.0.0]: https://github.com/nate1029/Impulse/releases/tag/v1.0.0
