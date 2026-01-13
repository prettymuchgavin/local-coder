import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { input, select } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';

dotenv.config();

export interface Config {
  baseURL: string;
  model: string;
}

interface ModelInfo {
  id: string;
  object: string;
  created?: number;
  owned_by?: string;
}

interface ModelsResponse {
  object: string;
  data: ModelInfo[];
}

const CONFIG_PATH = path.join(process.cwd(), '.local-coder-config.json');

async function fetchAvailableModels(baseURL: string): Promise<ModelInfo[]> {
  const spinner = ora('Fetching available models from LM Studio...').start();
  
  try {
    const response = await fetch(`${baseURL}/models`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json() as ModelsResponse;
    spinner.succeed('Connected to LM Studio');
    return data.data || [];
  } catch (error: any) {
    spinner.fail('Failed to connect to LM Studio');
    throw error;
  }
}

export async function selectModel(baseURL: string): Promise<string> {
  console.log(chalk.cyan('\n🔍 Checking for running models in LM Studio...\n'));
  
  try {
    const models = await fetchAvailableModels(baseURL);
    
    if (models.length === 0) {
      console.log(chalk.yellow('No models currently loaded in LM Studio.'));
      console.log(chalk.dim('Please load a model in LM Studio and try again, or enter a model name manually.\n'));
      
      const manualModel = await input({ 
        message: 'Enter model name (or press Enter for default):',
        default: 'local-model'
      });
      return manualModel;
    }
    
    if (models.length === 1) {
      console.log(chalk.green(`✓ Found 1 model: ${chalk.bold(models[0].id)}\n`));
      return models[0].id;
    }
    
    console.log(chalk.green(`✓ Found ${models.length} models\n`));
    
    const selectedModel = await select({
      message: 'Select a model to use:',
      choices: models.map(model => ({
        name: model.id,
        value: model.id,
        description: model.owned_by ? `Owned by: ${model.owned_by}` : undefined
      }))
    });
    
    return selectedModel;
    
  } catch (error: any) {
    console.log(chalk.red(`\n⚠ Could not fetch models: ${error.message}`));
    console.log(chalk.dim('Make sure LM Studio is running and the server is started.\n'));
    
    const manualModel = await input({ 
      message: 'Enter model name manually (or press Enter for default):',
      default: 'local-model'
    });
    return manualModel;
  }
}

export async function loadConfig(): Promise<Config> {
  let config: Config = {
    baseURL: 'http://localhost:1234/v1',
    model: 'local-model',
  };

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      config = { ...config, ...JSON.parse(data) };
    } catch (e) {
      // Ignore error
    }
  }

  // Allow env vars to override base URL
  if (process.env.LOCAL_LLM_BASE_URL) config.baseURL = process.env.LOCAL_LLM_BASE_URL;
  
  // Select model from LM Studio (skip if env var is set)
  if (process.env.LOCAL_LLM_MODEL) {
    config.model = process.env.LOCAL_LLM_MODEL;
  } else {
    config.model = await selectModel(config.baseURL);
  }

  return config;
}

export function createClient(config: Config): OpenAI {
  return new OpenAI({
    baseURL: config.baseURL,
    apiKey: 'lm-studio', // Arbitrary for local servers
  });
}
