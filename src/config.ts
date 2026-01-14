import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { input, select, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';

dotenv.config();

export interface Config {
  baseURL: string;
  model: string;
  dualMode: boolean;
  thinkingModel: string;
  executingModel: string;
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

export async function selectModel(baseURL: string, purpose?: string): Promise<string> {
  const label = purpose ? ` for ${purpose}` : '';
  console.log(chalk.cyan(`\n🔍 Checking for running models${label}...\n`));
  
  try {
    const models = await fetchAvailableModels(baseURL);
    
    if (models.length === 0) {
      console.log(chalk.yellow('No models currently loaded in LM Studio.'));
      console.log(chalk.dim('Please load a model in LM Studio and try again, or enter a model name manually.\n'));
      
      const manualModel = await input({ 
        message: `Enter model name${label} (or press Enter for default):`,
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
      message: purpose ? `Select ${purpose} model:` : 'Select a model to use:',
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
      message: `Enter model name${label} manually (or press Enter for default):`,
      default: 'local-model'
    });
    return manualModel;
  }
}

export async function selectDualModels(baseURL: string): Promise<{ thinking: string; executing: string }> {
  console.log(chalk.cyan('\n🧠 Dual-Model Mode'));
  console.log(chalk.dim('Select models for thinking (planning) and executing (coding)\n'));
  
  try {
    const models = await fetchAvailableModels(baseURL);
    
    if (models.length === 0) {
      console.log(chalk.yellow('No models found. Using default for both.\n'));
      return { thinking: 'local-model', executing: 'local-model' };
    }
    
    // Ask if user wants to use same model for both
    const useSameModel = await confirm({
      message: 'Use the same model for both thinking and executing?',
      default: models.length === 1
    });
    
    if (useSameModel) {
      let model: string;
      if (models.length === 1) {
        model = models[0].id;
        console.log(chalk.green(`✓ Using ${chalk.bold(model)} for both roles\n`));
      } else {
        model = await select({
          message: 'Select model for both thinking and executing:',
          choices: models.map(m => ({ name: m.id, value: m.id }))
        });
      }
      return { thinking: model, executing: model };
    }
    
    // Select thinking model
    console.log(chalk.magenta('\n📊 Thinking Model') + chalk.dim(' (for planning and reasoning)'));
    const thinkingModel = await select({
      message: 'Select thinking model:',
      choices: models.map(m => ({ 
        name: m.id, 
        value: m.id,
        description: 'Analyzes problems and creates plans'
      }))
    });
    
    // Select executing model
    console.log(chalk.cyan('\n⚡ Executing Model') + chalk.dim(' (for coding and tools)'));
    const executingModel = await select({
      message: 'Select executing model:',
      choices: models.map(m => ({ 
        name: m.id, 
        value: m.id,
        description: 'Writes code and runs commands'
      }))
    });
    
    console.log(chalk.green(`\n✓ Thinking: ${chalk.bold(thinkingModel)}`));
    console.log(chalk.green(`✓ Executing: ${chalk.bold(executingModel)}\n`));
    
    return { thinking: thinkingModel, executing: executingModel };
    
  } catch (error: any) {
    console.log(chalk.red(`\n⚠ Could not fetch models: ${error.message}`));
    return { thinking: 'local-model', executing: 'local-model' };
  }
}

export async function loadConfig(dualMode: boolean = false): Promise<Config> {
  let config: Config = {
    baseURL: 'http://localhost:1234/v1',
    model: 'local-model',
    dualMode: dualMode,
    thinkingModel: 'local-model',
    executingModel: 'local-model',
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
  
  config.dualMode = dualMode;
  
  if (dualMode) {
    // Select dual models
    const models = await selectDualModels(config.baseURL);
    config.thinkingModel = models.thinking;
    config.executingModel = models.executing;
    config.model = models.executing; // Default model is executing model
  } else {
    // Single model mode
    if (process.env.LOCAL_LLM_MODEL) {
      config.model = process.env.LOCAL_LLM_MODEL;
    } else {
      config.model = await selectModel(config.baseURL);
    }
    config.thinkingModel = config.model;
    config.executingModel = config.model;
  }

  return config;
}

export function createClient(config: Config): OpenAI {
  return new OpenAI({
    baseURL: config.baseURL,
    apiKey: 'lm-studio', // Arbitrary for local servers
  });
}
