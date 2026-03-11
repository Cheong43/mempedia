
import * as fs from 'fs';
import * as path from 'path';
import { Agent } from './agent/index.js';
import * as os from 'os';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const args = process.argv.slice(2);
const dataFile = args[0];
const outFile = args[1];
const model = process.env.ARK_MODEL || process.env.OPENAI_MODEL || args[2] || 'gpt-4o';
const apiKey = process.env.ARK_API_KEY || process.env.OPENAI_API_KEY || '';
const baseURL = process.env.ARK_BASE_URL || process.env.OPENAI_BASE_URL;
const hmacAccessKey = process.env.HMAC_ACCESS_KEY?.trim();
const hmacSecretKey = process.env.HMAC_SECRET_KEY?.trim();
const memoryHmacAccessKey = process.env.MEMORY_HMAC_ACCESS_KEY?.trim();
const memoryHmacSecretKey = process.env.MEMORY_HMAC_SECRET_KEY?.trim();
const gatewayApiKey = process.env.GATEWAY_API_KEY?.trim();
const memoryGatewayApiKey = process.env.MEMORY_GATEWAY_API_KEY?.trim();

const binaryPath = path.resolve(process.cwd(), '../target/release/mempedia');


if (!dataFile || !outFile) {
  console.error('Usage: ts-node src/locomo_adapter.ts <data-file> <out-file> [model]');
  process.exit(1);
}

// Ensure output directory exists
const outDir = path.dirname(outFile);
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const samples = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
const results: any[] = [];

// Check for existing results to resume
if (fs.existsSync(outFile)) {
  try {
    const existing = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
    results.push(...existing);
  } catch (e) {
    console.warn('Could not read existing results, starting fresh.');
  }
}

const processedIds = new Set(results.map((r: any) => r.sample_id));

async function processSample(sample: any) {
  if (processedIds.has(sample.sample_id)) {
    console.log(`Skipping processed sample ${sample.sample_id}`);
    return;
  }

  console.log(`Processing sample ${sample.sample_id}`);
  
  // Create temp dir for this sample
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `mempedia-locomo-${sample.sample_id}-`));
  console.log(`  Temp dir: ${tempDir}`);

  const agent = new Agent({
    apiKey: apiKey,
    baseURL: baseURL,
    model: model,
    hmacAccessKey,
    hmacSecretKey,
    memoryHmacAccessKey,
    memoryHmacSecretKey,
    gatewayApiKey,
    memoryGatewayApiKey
  }, tempDir, binaryPath);

  try {
    await agent.start();

    // Ingest conversation history
    const conversation = sample.conversation;
    const sessionKeys = Object.keys(conversation).filter(k => k.startsWith('session_') && !k.includes('date_time')).sort((a, b) => {
        const numA = parseInt(a.split('_')[1]);
        const numB = parseInt(b.split('_')[1]);
        return numA - numB;
    });

    for (const sessionKey of sessionKeys) {
      const sessionNum = sessionKey.split('_')[1];
      const dateTime = conversation[`session_${sessionNum}_date_time`];
      const dialogs = conversation[sessionKey];
      
      console.log(`  Ingesting Session ${sessionNum} (${dateTime})...`);
      
      let transcript = `Date: ${dateTime}\n\n`;
      for (const turn of dialogs) {
        transcript += `${turn.speaker}: ${turn.text}`;
        if (turn.blip_caption) {
            transcript += ` [Image: ${turn.blip_caption}]`;
        }
        transcript += '\n';
      }

      // Feed session to agent
      // We wrap it in a "User" message telling the agent to remember this.
      const prompt = `Here is the transcript of a conversation session that happened on ${dateTime}. Please read it and remember the key events, facts, and user preferences found in it. Do not reply to the conversation, just acknowledge that you have stored the memory.\n\n${transcript}`;
      
      await agent.run(prompt, (event) => {
        if (event.type === 'thought') {
            // console.log(`    Thought: ${event.content.substring(0, 50)}...`);
        }
      });
    }

    // Answer questions
    const answers = [];
    console.log(`  Answering ${sample.qa.length} questions...`);
    
    for (const qa of sample.qa) {
      const question = qa.question;
      let prompt = `Based on the conversation history you have remembered, please answer the following question:\n\n${question}\n\nAnswer concisely.`;
      
      if (qa.category === 5) { // Multiple choice
         prompt += `\nSelect the correct answer from: (a) ${qa.answer} (b) Not mentioned.`;
      }

      const answer = await agent.run(prompt, () => {});
      
      // Store result in the format expected by locomo
      // locomo expects: sample_id, qa: [ { ..., prediction_key: answer } ]
      // We will construct the 'qa' array with our predictions.
      // But actually, locomo's evaluate_qa.py expects the output file to contain the list of samples with 'qa' list where each item has the prediction.
      
      // We'll just store the answer text for now, the python wrapper will handle formatting if needed.
      // But wait, the adapter is writing the OUT_FILE.
      // So I should match the output format.
      
      // The QA object in output should be a copy of input QA plus the prediction.
      const qaResult = { ...qa };
      qaResult[`${model}_prediction`] = answer;
      answers.push(qaResult);
    }

    const result = {
      sample_id: sample.sample_id,
      qa: answers
    };

    results.push(result);
    fs.writeFileSync(outFile, JSON.stringify(results, null, 2));

  } catch (e) {
    console.error(`  Error processing sample ${sample.sample_id}:`, e);
  } finally {
    agent.stop();
    // Clean up temp dir
    try {
        fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
        console.error(`  Failed to cleanup temp dir ${tempDir}`, e);
    }
  }
}

async function main() {
  for (const sample of samples) {
    await processSample(sample);
  }
}

main().catch(console.error);
