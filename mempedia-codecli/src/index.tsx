import React from 'react';
import { render } from 'ink';
import { App } from './components/App.js';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

// Load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const arkApiKey = process.env.ARK_API_KEY?.trim();
const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
const useArkProvider = Boolean(arkApiKey);

const apiKey = useArkProvider ? arkApiKey : openaiApiKey;
const baseURL = useArkProvider
  ? process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/coding/v3'
  : process.env.OPENAI_BASE_URL;
const model = useArkProvider
  ? process.env.ARK_MODEL || 'Kimi-K2.5'
  : process.env.OPENAI_MODEL || 'gpt-4o';
const memoryApiKey = process.env.MEMORY_API_KEY?.trim();
const memoryBaseURL = process.env.MEMORY_BASE_URL || process.env.CODING_PLAN_BASE_URL;
const memoryModel = process.env.MEMORY_MODEL || process.env.CODING_PLAN_MODEL;

if (!apiKey) {
  console.error('Error: API KEY is not set. Please set OPENAI_API_KEY or ARK_API_KEY in .env file.');
  process.exit(1);
}

const m2wRoot = path.resolve(process.cwd(), '..');

// Verify m2wRoot has .mempedia or Cargo.toml
if (!fs.existsSync(path.join(m2wRoot, 'Cargo.toml'))) {
    console.warn(`Warning: Could not find Cargo.toml in ${m2wRoot}. Using current directory as project root.`);
}

render(
  <App
    apiKey={apiKey}
    projectRoot={m2wRoot}
    baseURL={baseURL}
    model={model}
    memoryApiKey={memoryApiKey}
    memoryBaseURL={memoryBaseURL}
    memoryModel={memoryModel}
  />
);
