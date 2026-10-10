# Privacy

Impulse IDE runs on your computer. It has no account, no analytics and no telemetry. This page lists everything it stores and every time it contacts the internet.

## What stays on your computer

- **Your sketches and circuits** stay in the folders you open. Circuits are saved as `diagram.json` next to each sketch.
- **Settings, open tabs and approved folders** live in the app's data folder (`Impulse IDE` under your system's application-data location).
- **AI API keys** are encrypted with your operating system's credential store (Keychain on macOS, DPAPI on Windows, libsecret on Linux). The interface only ever shows their last four characters.
- **Logs and crash records** (warnings, errors, crash details) are written to the app's logs and data folders and never leave the computer on their own.

## When Impulse uses the internet

| What | Sent to | When |
|---|---|---|
| Your prompt, the open sketch and the context you include (board, wiring, compiler or serial output) | The AI provider you chose (Anthropic, OpenAI or Google), with your own API key | Only when you use the AI assistant, the AI circuit builder or "Fix with AI". Their privacy terms apply to that data. |
| Update check (app version) | GitHub Releases (`Meet-1010/Impulse-IDE-v2`) | At launch and every few hours, in installed builds |
| Download of arduino-cli | GitHub (`arduino/arduino-cli` releases), checked against a SHA-256 built into the app | Only if you choose "Set up now" and no arduino-cli is installed |
| Board, core and library indexes and downloads | Arduino's servers and any board URLs you added, through arduino-cli | When you install boards or libraries, or compile with a library that isn't installed yet |
| Problem reports and part requests | Your browser opens a GitHub issue form | Only when you choose to; you review the text and submit it yourself on GitHub |

Impulse never sends your sketches, circuits, serial data, keys or files anywhere else.

## Your control

- Leave the AI provider unset to keep everything local.
- Remove an API key in the AI settings at any time.
- Delete the app's data folder to remove every setting and log.

Questions: open an issue at https://github.com/Meet-1010/Impulse-IDE-v2/issues.
