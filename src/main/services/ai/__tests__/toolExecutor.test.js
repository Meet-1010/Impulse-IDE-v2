const ToolExecutor = require('../tools/toolExecutor');

function makeExecutor({ confirm = true, uploadResult = { success: true, output: 'ok' } } = {}) {
  const arduinoService = {
    upload: jest.fn().mockResolvedValue(uploadResult),
    compile: jest.fn().mockResolvedValue({ success: false, error: { message: 'Arduino CLI is not available' } }),
  };
  const serialMonitor = { isConnected: false, disconnect: jest.fn() };
  const executor = new ToolExecutor(arduinoService, serialMonitor, {}, null);
  const confirmUpload = jest.fn().mockResolvedValue(confirm);
  executor.setUICallbacks({
    getCurrentSketchPath: async () => '/projects/blink/blink.ino',
    getSelectedBoard: async () => 'arduino:avr:uno',
    getSelectedPort: async () => '/dev/cu.usbmodem1',
    saveSketch: jest.fn().mockResolvedValue('/projects/blink/blink.ino'),
    confirmUpload,
  });
  return { executor, arduinoService, confirmUpload };
}

describe('ToolExecutor', () => {
  it('rejects unknown tools and arguments of the wrong type', async () => {
    const { executor } = makeExecutor();
    expect((await executor.execute({ name: 'rm_rf', arguments: {} })).success).toBe(false);
    const bad = await executor.execute({ name: 'set_baud_rate', arguments: { baudRate: 'fast' } });
    expect(bad.success).toBe(false);
    expect(bad.error).toContain('baudRate');
  });

  it('rejects non-object arguments', async () => {
    const { executor } = makeExecutor();
    const res = await executor.execute({ name: 'list_ports', arguments: 'oops' });
    expect(res.success).toBe(false);
  });

  it('asks the user before an agent upload and stops when declined', async () => {
    const { executor, arduinoService, confirmUpload } = makeExecutor({ confirm: false });
    const res = await executor.execute({ name: 'upload_sketch', arguments: {} });
    expect(confirmUpload).toHaveBeenCalledWith({
      sketchPath: '/projects/blink/blink.ino', boardFQBN: 'arduino:avr:uno', port: '/dev/cu.usbmodem1'
    });
    expect(arduinoService.upload).not.toHaveBeenCalled();
    expect(res.success).toBe(false);
    expect(res.error).toContain('declined');
  });

  it('uploads after the user approves', async () => {
    const { executor, arduinoService } = makeExecutor({ confirm: true });
    const res = await executor.execute({ name: 'upload_sketch', arguments: {} });
    expect(arduinoService.upload).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
  });

  it('reports a failed compile as a failure, not a success', async () => {
    const { executor } = makeExecutor();
    const res = await executor.execute({ name: 'compile_sketch', arguments: {} });
    expect(res.success).toBe(false);
    expect(res.error).toContain('Arduino CLI is not available');
  });
});
