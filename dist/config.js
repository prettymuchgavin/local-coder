"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectModel = selectModel;
exports.loadConfig = loadConfig;
exports.createClient = createClient;
const openai_1 = __importDefault(require("openai"));
const dotenv = __importStar(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prompts_1 = require("@inquirer/prompts");
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
dotenv.config();
const CONFIG_PATH = path_1.default.join(process.cwd(), '.local-coder-config.json');
async function fetchAvailableModels(baseURL) {
    const spinner = (0, ora_1.default)('Fetching available models from LM Studio...').start();
    try {
        const response = await fetch(`${baseURL}/models`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        spinner.succeed('Connected to LM Studio');
        return data.data || [];
    }
    catch (error) {
        spinner.fail('Failed to connect to LM Studio');
        throw error;
    }
}
async function selectModel(baseURL) {
    console.log(chalk_1.default.cyan('\n🔍 Checking for running models in LM Studio...\n'));
    try {
        const models = await fetchAvailableModels(baseURL);
        if (models.length === 0) {
            console.log(chalk_1.default.yellow('No models currently loaded in LM Studio.'));
            console.log(chalk_1.default.dim('Please load a model in LM Studio and try again, or enter a model name manually.\n'));
            const manualModel = await (0, prompts_1.input)({
                message: 'Enter model name (or press Enter for default):',
                default: 'local-model'
            });
            return manualModel;
        }
        if (models.length === 1) {
            console.log(chalk_1.default.green(`✓ Found 1 model: ${chalk_1.default.bold(models[0].id)}\n`));
            return models[0].id;
        }
        console.log(chalk_1.default.green(`✓ Found ${models.length} models\n`));
        const selectedModel = await (0, prompts_1.select)({
            message: 'Select a model to use:',
            choices: models.map(model => ({
                name: model.id,
                value: model.id,
                description: model.owned_by ? `Owned by: ${model.owned_by}` : undefined
            }))
        });
        return selectedModel;
    }
    catch (error) {
        console.log(chalk_1.default.red(`\n⚠ Could not fetch models: ${error.message}`));
        console.log(chalk_1.default.dim('Make sure LM Studio is running and the server is started.\n'));
        const manualModel = await (0, prompts_1.input)({
            message: 'Enter model name manually (or press Enter for default):',
            default: 'local-model'
        });
        return manualModel;
    }
}
async function loadConfig() {
    let config = {
        baseURL: 'http://localhost:1234/v1',
        model: 'local-model',
    };
    if (fs_1.default.existsSync(CONFIG_PATH)) {
        try {
            const data = fs_1.default.readFileSync(CONFIG_PATH, 'utf-8');
            config = { ...config, ...JSON.parse(data) };
        }
        catch (e) {
            // Ignore error
        }
    }
    // Allow env vars to override base URL
    if (process.env.LOCAL_LLM_BASE_URL)
        config.baseURL = process.env.LOCAL_LLM_BASE_URL;
    // Select model from LM Studio (skip if env var is set)
    if (process.env.LOCAL_LLM_MODEL) {
        config.model = process.env.LOCAL_LLM_MODEL;
    }
    else {
        config.model = await selectModel(config.baseURL);
    }
    return config;
}
function createClient(config) {
    return new openai_1.default({
        baseURL: config.baseURL,
        apiKey: 'lm-studio', // Arbitrary for local servers
    });
}
