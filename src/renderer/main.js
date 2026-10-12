/**
 * Vite entry point for the renderer process.
 * Bundles CodeMirror locally (no CDN), imports all CSS and scripts.
 */

// Must run first so errors thrown while later modules load are captured.
import './error-capture.js';

// --- CodeMirror CSS (bundled locally, no CDN) ---
import 'codemirror/lib/codemirror.css';
import 'codemirror/addon/hint/show-hint.css';
import 'codemirror/addon/dialog/dialog.css';

// --- Fonts (bundled; the app must look right offline) ---
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';

// --- App CSS ---
import './styles.css';
import './simulation/simulation.css';
import './design-system.css';
import './morph-orb/morph-orb.css';

// --- CodeMirror JS (bundled locally, no CDN) ---
import CodeMirror from 'codemirror';
import 'codemirror/mode/clike/clike';
import 'codemirror/addon/hint/show-hint';
import 'codemirror/addon/hint/anyword-hint';
import 'codemirror/addon/dialog/dialog';
import 'codemirror/addon/search/searchcursor';
import 'codemirror/addon/search/search';
import 'codemirror/addon/search/jump-to-line';
import 'codemirror/addon/edit/matchbrackets';
import 'codemirror/addon/edit/closebrackets';
import 'codemirror/addon/selection/active-line';
import { setCodeMirror } from './codemirror-ref.js';
import { defineArduinoMode } from './arduino-mode.js';

defineArduinoMode(CodeMirror);
setCodeMirror(CodeMirror);
window.CodeMirror = CodeMirror;

// --- Application scripts (side-effect imports) ---
import './notifications.js';
import './tooltips.js';
import './validation.js';
import './onboarding.js';
import './accessibility.js';
import './renderer.js';
import './ui-shell.js';
