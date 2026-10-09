/**
 * Zod schemas for IPC input validation. Use parseOrDefault to get safe defaults instead of throwing.
 * @module main/ipc/schemas
 */

const { z } = require('zod');

/** Non-empty string, max 16k chars to avoid huge payloads */
const requiredString = z.string().min(1).max(16 * 1024);
const safeString = z.string().max(16 * 1024).optional().nullable();

/** Path: string, no null bytes, reasonable length */
const pathSchema = z.string().min(1).max(4096).refine(v => !v.includes('\0'), 'Path must not contain null bytes');

/** Valid baud rate */
const baudRate = z.union([
  z.number().int().min(300).max(2000000),
  z.coerce.number().int().min(300).max(2000000)
]).optional().default(115200);

const schemas = {
  arduinoCompile: z.object({ sketchPath: requiredString, boardFQBN: requiredString }),
  arduinoUpload: z.object({ sketchPath: requiredString, boardFQBN: requiredString, port: requiredString }),
  serialConnect: z.object({ port: requiredString, baudRate }),
  serialSend: z.object({ data: z.string().optional().default('') }),
  folderList: z.object({ dirPath: pathSchema }),
  fileRead: z.object({ filePath: pathSchema }),
  fileSave: z.object({ filePath: pathSchema, content: z.string().max(2 * 1024 * 1024) }),
  libSearch: z.object({ query: safeString.default('') }),
  libInstall: z.object({ libSpec: requiredString }),
  libUninstall: z.object({ libName: requiredString }),
  saveAsSketch: z.object({ content: z.string().max(2 * 1024 * 1024).optional().nullable() }),
  shellOpenExternal: z.object({ url: z.string().refine(u => u.startsWith('http://') || u.startsWith('https://'), 'Invalid URL') }),
  shellShowItem: z.object({ fullPath: pathSchema }),
  errorsAddFix: z.object({ errorId: safeString, fix: z.record(z.unknown()).optional() }),
  aiSetProvider: z.object({ providerName: requiredString, apiKey: z.string().optional().nullable(), model: safeString }),
  aiProcessQuery: z.object({
    query: requiredString,
    context: z.record(z.unknown()).optional().default({}),
    mode: z.enum(['agent', 'ask', 'debug']).optional().default('agent')
  }),
  aiAnalyzeError: z.object({ errorMessage: requiredString, context: z.record(z.unknown()).optional() }),
  aiAnalyzeSerial: z.object({ serialOutput: z.string().optional().default(''), lines: z.array(z.string()).optional().default([]) }),
  aiSetModel: z.object({ modelId: requiredString, manual: z.boolean().optional() }),
  aiPinModel: z.object({ modelId: z.string().optional().nullable() }),
  aiSetAutoUpgrade: z.object({ enabled: z.boolean() }),
  aiExecuteTool: z.object({ toolName: requiredString, args: z.record(z.unknown()).optional().default({}) }),
  apiKeysSet: z.object({ provider: requiredString, apiKey: requiredString }),
  apiKeysProvider: z.object({ provider: requiredString }),
  exampleCreate: z.object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,60}$/, 'Example names are lower-case letters, digits and dashes'),
    code: z.string().min(1).max(512 * 1024),
    diagram: z.string().min(2).max(4 * 1024 * 1024)
  }),
  diagramSave: z.object({
    content: z.string().min(2).max(4 * 1024 * 1024),
    suggestedName: z.string().max(255).refine(v => !/[\\/\0]/.test(v), 'Invalid file name')
  }),
  aiGenerateCircuit: z.object({
    code: z.string().min(1).max(256 * 1024),
    board: z.string().max(64).optional().default('uno'),
    catalog: z.string().max(256 * 1024).optional().default('')
  })
};

/**
 * Parse value with the given schema. Returns safe default on failure instead of throwing.
 * @param {z.ZodType} schema - Zod schema (e.g. schemas.arduinoCompile)
 * @param {unknown} value - Value to parse
 * @param {{ success: boolean, error?: string }} defaultResult - Returned when validation fails
 * @returns {{ ok: true, data: unknown } | { ok: false, error: string, defaultResult: { success: boolean } }}
 */
function parseOrDefault(schema, value, defaultResult = { success: false, error: 'Invalid input' }) {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  // Extract actual field-level error messages from Zod issues
  const message = result.error.issues.map(i => i.message).join(', ') || 'Validation failed';
  return { ok: false, error: message, defaultResult };
}

module.exports = { schemas, parseOrDefault };
