// The runner for a board: AVR boards run on avr8js, the Raspberry Pi Pico on
// rp2040js. Both present the same surface to the engine and the UI.

import { AvrRunner } from './avr-runner.js';
import { Rp2040Runner } from './rp2040-runner.js';
import { boardById } from './boards.js';

/** 'avr' or 'rp2040'. */
export const runnerFamily = (boardId) => (boardById(boardId).family === 'rp2040' ? 'rp2040' : 'avr');

export function createRunner(boardId) {
  return runnerFamily(boardId) === 'rp2040' ? new Rp2040Runner() : new AvrRunner();
}

/** The program in a compile result: HEX text for AVR boards, UF2 bytes for the Pico. */
export const programOf = (result) => result?.hex ?? result?.uf2 ?? null;
