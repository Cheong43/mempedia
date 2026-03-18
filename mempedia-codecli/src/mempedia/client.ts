import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import { ToolAction, ToolResponse } from './types.js';
import { resolveMempediaBinaryPath } from '../config/projectPaths.js';

export class MempediaClient {
  private process: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private requestQueue: Array<{ 
    resolve: (data: ToolResponse) => void; 
    reject: (err: any) => void 
  }> = [];

  constructor(private projectRoot: string, private binaryPath?: string) {}

  start() {
    const binaryPath = resolveMempediaBinaryPath(import.meta.dirname, this.binaryPath);
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
    });
    
    this.process.on('exit', (code: number | null) => {
       if (code !== 0 && code !== null) {
           console.error(`Mempedia process exited with code ${code}`);
       }
    });
  }

  async send(action: ToolAction): Promise<ToolResponse> {
    if (!this.process || !this.process.stdin) {
      throw new Error('Mempedia client not started');
    }

    return new Promise((resolve, reject) => {
      this.requestQueue.push({ resolve, reject });
      try {
        this.process!.stdin!.write(JSON.stringify(action) + '\n');
      } catch (err) {
        // If write fails, remove from queue
        this.requestQueue.pop();
        reject(err);
      }
    });
  }

  stop() {
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
