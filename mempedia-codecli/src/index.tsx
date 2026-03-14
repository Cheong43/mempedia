import React from 'react';
import { render, Text } from 'ink';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';

import { App } from './components/App.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const apiKey = process.env.ARK_API_KEY || process.env.OPENAI_API_KEY || '';
const baseURL = process.env.ARK_BASE_URL || process.env.OPENAI_BASE_URL;
const model = process.env.ARK_MODEL || process.env.OPENAI_MODEL;
const memoryApiKey = process.env.MEMORY_API_KEY;
const memoryBaseURL = process.env.MEMORY_BASE_URL;
const memoryModel = process.env.MEMORY_MODEL;

const projectRoot =
  process.env.MEMPEDIA_PROJECT_ROOT || path.resolve(__dirname, '../..');

if (!apiKey) {
  render(
    <Text>
      Missing API key. Please set `ARK_API_KEY` or `OPENAI_API_KEY` in
      `mempedia-codecli/.env`.
    </Text>
  );
  process.exit(1);
}

render(
  <App
    apiKey={apiKey}
    projectRoot={projectRoot}
    baseURL={baseURL}
    model={model}
    memoryApiKey={memoryApiKey}
    memoryBaseURL={memoryBaseURL}
    memoryModel={memoryModel}
  />
);
