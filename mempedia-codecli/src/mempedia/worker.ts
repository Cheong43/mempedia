import { parentPort, workerData } from 'worker_threads';
import { MempediaClient } from './client.js';
import { ToolAction } from './types.js';

if (!parentPort) {
  throw new Error('This file must be run as a worker thread');
}

const { projectRoot, binaryPath } = workerData;
const client = new MempediaClient(projectRoot, binaryPath);

// Start the Mempedia client process
try {
  client.start();
} catch (error: any) {
  parentPort.postMessage({ type: 'error', error: error.message });
  process.exit(1);
}

parentPort.on('message', async (message: { id: string; action: ToolAction }) => {
  const { id, action } = message;
  try {
    const result = await client.send(action);
    parentPort!.postMessage({ type: 'result', id, result });
  } catch (error: any) {
    parentPort!.postMessage({ type: 'error', id, error: error.message });
  }
});

// Cleanup on exit
process.on('exit', () => {
  client.stop();
});
