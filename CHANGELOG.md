# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Simulator boards: Arduino Nano and Arduino Mega 2560 (ATmega2560: ports A–L, timers 0–5, Serial1–3, 16 analog inputs) alongside the Uno; switching boards keeps wires on matching pins.
- Circuit engine with real nets and voltages: pull-ups, voltage dividers, breadboards (full, half, mini), short-circuit detection, and parts that react to each other as well as to the Arduino.
- 89 simulated parts, including LCD 16×2/20×4 (I²C and parallel), SSD1306, ILI9341, NeoPixels, MAX7219, TM1637, HC-SR04, DHT11/22, DS18B20, MPU6050, DS1307, HX711, keypads, KY-040, IR remote, servos, steppers (NEMA 17, 28BYJ-48 + ULN2003, A4988), L293D, L298N, relays, 74HC595, NPN and MOSFET transistors, diodes, capacitors, batteries, logic gates and a D flip-flop.
- Part picker with search, categories, thumbnails and drag-to-place; advice when a part or board isn't simulated.
- Inspector with live controls (distance, temperature, light…), pin documentation, wiring and library install.
- 36 example projects (Sketch + circuit) in a searchable gallery, each compiled and simulated by the test suite.
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

- Claude provider: Opus 5.5 / Sonnet 5.5 / Fable 5.1 / Haiku 4.5, effort per mode, streaming, refusal and truncation handling, server-side fallbacks.
- API keys moved to the OS credential store; keys from the old store are migrated once.
- File access is denied by default; folder approvals persist in the main process.
- Keyboard shortcuts come only from the application menu (⌘ on macOS, no double firing).
- Removed the unused terminal, plugin and collaboration services and their dependencies.

### Fixed

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

[Unreleased]: https://github.com/nate1029/Impulse/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/nate1029/Impulse/releases/tag/v1.0.0
