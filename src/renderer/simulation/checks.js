// Circuit check: wiring problems found without running the sketch (missing
// resistors and power, floating logic inputs, I²C clashes, batteries on pins),
// plus any shorts the last run reported.

import { staticTopology } from './engine.js';
import { partDef } from './parts/catalog.js';
import { BOARDS, basePinName, boardByTag, boardPinNumber, pinLabel } from './boards.js';

/**
 * @param {{ parts: {id, type, attrs, el?}[], wires: object[], links?: [string, string][] }} model
 * @param {{ shorts?: { tags: string[] }[] }} [options]
 * @returns {{ level: 'error'|'warn'|'info', part?: string, text: string }[]}
 */
export function circuitChecks(model, { shorts = [] } = {}) {
  const issues = [];
  const boardPart = model.parts.find(p => partDef(p.type)?.board) || null;
  const board = (boardPart && boardByTag(partDef(boardPart.type).tag)) || BOARDS.uno;
  if (!boardPart) issues.push({ level: 'error', text: 'There is no Arduino board. Pick one from the board menu.' });
  const circuit = staticTopology(model);
  // Connected to another part: a button's own contacts or a pot's track don't count.
  const linked = (node) => {
    const net = circuit.netOf(node);
    if (net < 0) return false;
    const own = `${node.slice(0, node.indexOf(':'))}:`;
    const foreign = (n) => circuit.nodesOf(n).some(x => !x.startsWith(own));
    return foreign(net) || circuit.resistiveNeighbors(net, 1).some(r => foreign(r.net));
  };
  const onBoard = (node) => {
    const net = circuit.netOf(node);
    return !!boardPart && net >= 0 && circuit.nodesOf(net).some(n => n.startsWith(`${boardPart.id}:`));
  };
  const i2c = new Map();
  for (const part of model.parts) {
    const def = partDef(part.type);
    if (!def || def.board || def.category === 'Breadboards') continue;
    const pins = part.el?.pinInfo?.map(p => p.name) || def.pinNames(part.attrs || {});
    if (pins.length && !pins.some(p => linked(`${part.id}:${p}`))) {
      issues.push({ level: 'info', part: part.id, text: `${part.id} (${def.label}) isn't connected to anything yet.` });
      continue;
    }
    if (part.type === 'wokwi-led') {
      if (onBoard(`${part.id}:A`)) issues.push({ level: 'warn', part: part.id, text: `${part.id} has no series resistor. On real hardware add 220 Ω so the LED and the pin survive.` });
      if (!linked(`${part.id}:C`)) issues.push({ level: 'warn', part: part.id, text: `${part.id}'s cathode (C) isn't connected, so it can't light. Wire it to GND.` });
      if (!linked(`${part.id}:A`)) issues.push({ level: 'warn', part: part.id, text: `${part.id}'s anode (A) isn't connected. Wire it to a pin through a resistor.` });
    }
    if (/^impulse-(gate-|flipflop)/.test(part.type)) {
      for (const pin of pins.filter(p => !['Y', 'Q', 'QN'].includes(p))) {
        if (!linked(`${part.id}:${pin}`)) issues.push({ level: 'warn', part: part.id, text: `${part.id}'s input ${pin} isn't connected. It reads LOW here, but a floating input on a real chip picks up noise: tie it to 5V, GND or a pin.` });
      }
    }
    if (part.type === 'impulse-battery' && boardPart) {
      const volts = Number(part.attrs.voltage ?? 9);
      const net = circuit.netOf(`${part.id}:+`);
      const boardPin = (n) => (n.startsWith(`${boardPart.id}:`) ? basePinName(n.slice(boardPart.id.length + 1)) : null);
      const onBoardPin = net >= 0 && circuit.nodesOf(net).map(boardPin).find(p => p && p !== 'VIN');
      const pinName = onBoardPin || null;
      if (pinName && /^GND/.test(pinName)) issues.push({ level: 'error', part: part.id, text: `${part.id}'s + is wired to GND, which shorts the battery.` });
      else if (pinName && volts > 5.5) issues.push({ level: 'error', part: part.id, text: `${part.id} puts ${volts} V straight onto ${boardPinNumber(board, pinName) !== null ? pinLabel(board, boardPinNumber(board, pinName)) : pinName}. Arduino pins take at most 5 V: power the board through VIN, or switch the battery with a transistor or relay.` });
    }
    if (part.type === 'impulse-ds18b20' && boardPart && linked(`${part.id}:DQ`)) {
      const net = circuit.netOf(`${part.id}:DQ`);
      const supply = (n) => n.startsWith(`${boardPart.id}:`) && ['5V', '3.3V', 'IOREF'].includes(basePinName(n.slice(boardPart.id.length + 1)));
      const pulled = circuit.resistiveNeighbors(net, 1).some(nb => circuit.nodesOf(nb.net).some(supply));
      if (!pulled) issues.push({ level: 'info', part: part.id, text: `${part.id} has no 4.7 kΩ pull-up from DQ to 5V. The simulator adds one, but a real 1-Wire bus needs it.` });
    }
    // A part can name its own supply pins (the L298N runs from 12V; its 5V pin is an output).
    const power = def.supplyPins || pins.filter(p => /^(VCC|VIN|VDD|5V|V\+)$/.test(p));
    const ground = pins.filter(p => /^(GND|VSS)$/.test(p));
    if (power.length && !power.some(p => linked(`${part.id}:${p}`))) {
      const to = /^\d+V$/.test(power[0]) && power[0] !== '5V' ? 'a battery or supply' : '5V';
      issues.push({ level: 'warn', part: part.id, text: `${part.id} (${def.label}) has no power: wire its ${power[0]} pin to ${to}.` });
    }
    if (ground.length && !ground.some(p => linked(`${part.id}:${p}`))) {
      issues.push({ level: 'warn', part: part.id, text: `${part.id} (${def.label}) has no ground: wire its ${ground[0]} pin to GND on the board.` });
    }
    const lcdAddr = part.attrs.pins === 'i2c' ? (part.attrs.i2cAddress || '0x27') : null;
    const addr = { 'wokwi-lcd1602': lcdAddr, 'wokwi-lcd2004': lcdAddr, 'wokwi-ssd1306': part.attrs.i2cAddress || '0x3c', 'wokwi-ds1307': '0x68', 'wokwi-mpu6050': '0x68' }[part.type];
    if (addr) {
      const key = addr.toLowerCase();
      if (i2c.has(key)) issues.push({ level: 'warn', part: part.id, text: `${i2c.get(key)} and ${part.id} both use I²C address ${key}; only one of them will answer.` });
      else i2c.set(key, part.id);
    }
  }
  for (const s of shorts) issues.push({ level: 'error', text: `Short circuit: ${s.tags.join(' and ')} are wired together while driving different levels. On real hardware this can damage the board.` });
  return issues;
}
