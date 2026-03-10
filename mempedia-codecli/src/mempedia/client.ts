import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';
import { ToolAction, ToolResponse } from './types.js';

export class MempediaClient {
  private process: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private requestSeq = 0;
  private requestTimeoutMs = Number(process.env.MEMPEDIA_REQUEST_TIMEOUT_MS || 0);
  private requestQueue: Array<{ 
    id: number;
    resolve: (data: ToolResponse) => void; 
    reject: (err: any) => void;
    timer?: NodeJS.Timeout;
  }> = [];

  constructor(private projectRoot: string, private binaryPath?: string) {}

  start() {
    const binaryPath = this.binaryPath || path.resolve(process.cwd(), '../target/release/mempedia');
    console.log(`Starting mempedia process: ${binaryPath} --project ${this.projectRoot}`);
    this.process = spawn(binaryPath, ['--serve', '--project', this.projectRoot], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error('Failed to start mempedia process');
    }

    this.rl = readline.createInterface({
      input: this.process.stdout,
      terminal: false,
    });

    this.rl.on('line', (line: string) => {
      const pending = this.requestQueue.shift();
      if (pending) {
        if (pending.timer) {
          clearTimeout(pending.timer);
        }
        try {
          const data = JSON.parse(line);
          pending.resolve(data);
        } catch (err) {
          pending.reject(err);
        }
      }
    });

    this.process.on('error', (err: Error) => {
      console.error('Mempedia process error:', err);
      this.failAllPending(err);
    });
    
    this.process.on('exit', (code: number | null) => {
       if (code !== 0 && code !== null) {
           console.error(`Mempedia process exited with code ${code}`);
       }
       this.failAllPending(new Error(`mempedia process exited with code ${code}`));
    });
  }

  async send(action: ToolAction): Promise<ToolResponse> {
    if (!this.process || !this.process.stdin) {
      throw new Error('Mempedia client not started');
    }

    return new Promise((resolve, reject) => {
      const id = ++this.requestSeq;
      let timer: NodeJS.Timeout | undefined;
      if (this.requestTimeoutMs > 0) {
        timer = setTimeout(() => {
          const index = this.requestQueue.findIndex((item) => item.id === id);
          if (index >= 0) {
            const [pending] = this.requestQueue.splice(index, 1);
            pending.reject(new Error(`mempedia request timeout after ${this.requestTimeoutMs}ms`));
          }
        }, this.requestTimeoutMs);
      }
      this.requestQueue.push({ id, resolve, reject, timer });
      try {
        this.process!.stdin!.write(JSON.stringify(action) + '\n');
      } catch (err) {
        // If write fails, remove from queue
        const last = this.requestQueue.pop();
        if (last?.timer) {
          clearTimeout(last.timer);
        }
        reject(err);
      }
    });
  }

  private failAllPending(err: any) {
    const items = this.requestQueue.splice(0, this.requestQueue.length);
    for (const pending of items) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(err);
    }
  }

  stop() {
    this.failAllPending(new Error('mempedia client stopped'));
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    if (this.rl) {
        this.rl.close();
        this.rl = null;
    }
  }
}
