import express from 'express';
import cors from 'cors';
import path from 'path';
import { OpenAI } from 'openai';
import { Config, createClient } from './config';
import { toolsDefinition, listFiles, readFile, writeFile, runShellCommand } from './tools';

interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: any[];
    tool_call_id?: string;
}

interface StreamedToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

// Store chat sessions and their configs
const sessions: Map<string, { history: ChatMessage[], dualMode: boolean }> = new Map();

// System prompts
const ENHANCER_SYSTEM_PROMPT = `# Enhanced AI Prompt Generator

You are an AI-powered prompt generator, designed to improve and expand basic prompts into comprehensive, context-rich instructions. Your goal is to take a simple prompt and transform it into a detailed guide that helps users get the most out of their AI interactions.

## Your process:

1. Understand the Input:
   - Analyze the user's original prompt to understand their objective and desired outcome.

2. Refine the Prompt:
   - Expand on the original prompt by providing detailed instructions.
   - Break down the enhanced prompt into clear steps or sections.
   - Ensure the improved prompt offers specific actions and points to address.

3. Structure the Enhanced Prompt:
   - Use clear sections with role definition, key responsibilities, approach, and specific tasks.
   - Use bullet points and subheadings for clarity.

## Output format:

Present the enhanced prompt as a well-structured, detailed guide. Only provide the output prompt without additional comments.`;

const EXECUTING_SYSTEM_PROMPT = `You are a skilled software engineer. You have function calling capabilities to interact with the file system.

Your available functions are: list_files, read_file, write_file, run_shell_command

IMPORTANT: Do NOT write out tool calls as text. The system will automatically detect when you want to use a tool. Just describe what you're doing and the tools will be invoked for you.

WORKFLOW:
1. First, check the current directory
2. Create any needed folders
3. Create files with real code
4. Run any setup commands
5. Summarize what you created

RULES:
- Narrate as you work: "I'll create the folder first...", "Now writing the main file..."
- Create project folders using kebab-case naming
- If something fails, explain and retry`;

const SINGLE_MODEL_PROMPT = `You are a skilled software engineer. You have function calling capabilities to interact with the file system.

Your available functions are: list_files, read_file, write_file, run_shell_command

IMPORTANT: Do NOT write out tool calls as text or JSON. The system handles tool invocation automatically. Just describe what you want to do and use the functions naturally.

RULES:
- Explain what you're doing as you work
- Be conversational but concise
- When creating a NEW PROJECT, create a dedicated folder first (use kebab-case naming)
- If something fails, explain and fix it`;


export async function startWebServer(config: Config) {
    const app = express();
    const port = process.env.PORT || 3000;

    app.use(cors());
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '../public')));

    let client = createClient(config);

    // Get available models
    app.get('/api/models', async (req, res) => {
        try {
            const response = await fetch(`${config.baseURL}/models`);
            const data = await response.json();
            res.json(data);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // Get current config
    app.get('/api/config', (req, res) => {
        res.json({
            model: config.model,
            baseURL: config.baseURL,
            dualMode: config.dualMode,
            thinkingModel: config.thinkingModel,
            executingModel: config.executingModel
        });
    });

    // Update single model
    app.post('/api/config/model', (req, res) => {
        const { model } = req.body;
        if (model) {
            config.model = model;
            config.thinkingModel = model;
            config.executingModel = model;
            res.json({ success: true, model });
        } else {
            res.status(400).json({ error: 'Model name required' });
        }
    });

    // Update dual mode config
    app.post('/api/config/dual', (req, res) => {
        const { enabled, thinkingModel, executingModel } = req.body;
        config.dualMode = enabled;
        if (thinkingModel) config.thinkingModel = thinkingModel;
        if (executingModel) config.executingModel = executingModel;
        res.json({ success: true, config: { dualMode: config.dualMode, thinkingModel: config.thinkingModel, executingModel: config.executingModel } });
    });

    // Update API key and base URL
    app.post('/api/config/api', (req, res) => {
        const { apiKey, baseURL } = req.body;
        let clientUpdated = false;

        if (apiKey !== undefined) {
            config.apiKey = apiKey || 'lm-studio';
            clientUpdated = true;
        }
        if (baseURL) {
            config.baseURL = baseURL;
            clientUpdated = true;
        }

        // Recreate client with new config
        if (clientUpdated) {
            client = createClient(config);
        }

        res.json({
            success: true,
            config: {
                baseURL: config.baseURL,
                hasApiKey: config.apiKey !== 'lm-studio'
            }
        });
    });

    // Chat endpoint with streaming
    app.post('/api/chat', async (req, res) => {
        const { message, sessionId = 'default', autoApprove = true, dualMode } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message required' });
        }

        // Use request dualMode or fall back to config
        const useDualMode = dualMode !== undefined ? dualMode : config.dualMode;

        // Get or create session
        if (!sessions.has(sessionId)) {
            sessions.set(sessionId, { history: [], dualMode: useDualMode });
        }
        const session = sessions.get(sessionId)!;

        // Set up SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const sendEvent = (type: string, data: any) => {
            if (!res.writableEnded) {
                res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
            }
        };

        // Handle client disconnect
        let clientDisconnected = false;
        req.on('close', () => {
            clientDisconnected = true;
        });

        try {
            if (useDualMode) {
                await processDualModeChat(client, config, message, sendEvent);
            } else {
                // Single model mode
                if (session.history.length === 0) {
                    session.history.push({ role: 'system', content: SINGLE_MODEL_PROMPT });
                }
                session.history.push({ role: 'user', content: message });
                await processSingleModeChat(client, config, session.history, sendEvent, autoApprove);
            }
            if (!clientDisconnected) {
                sendEvent('done', {});
            }
        } catch (error: any) {
            if (!clientDisconnected) {
                sendEvent('error', { message: error.message || 'Connection lost' });
            }
        }

        if (!res.writableEnded) {
            res.end();
        }
    });

    // Clear session
    app.post('/api/session/clear', (req, res) => {
        const { sessionId = 'default' } = req.body;
        sessions.delete(sessionId);
        res.json({ success: true });
    });

    app.listen(port, () => {
        console.log(`\n🌐 Web GUI running at http://localhost:${port}`);
        if (config.dualMode) {
            console.log(`   Mode: Dual-Model`);
            console.log(`   ✨ Enhancer:  ${config.thinkingModel}`);
            console.log(`   ⚡ Executor:  ${config.executingModel}`);
        } else {
            console.log(`   Model: ${config.model}`);
        }
        console.log(`   LM Studio: ${config.baseURL}\n`);
    });
}

// Dual-mode processing
async function processDualModeChat(
    client: OpenAI,
    config: Config,
    userMessage: string,
    sendEvent: (type: string, data: any) => void
) {
    // Phase 1: Enhancing the prompt
    sendEvent('phase_start', { phase: 'enhancing', model: config.thinkingModel });

    let enhancedPrompt = '';

    const enhancerStream = await client.chat.completions.create({
        model: config.thinkingModel,
        messages: [
            { role: 'system', content: ENHANCER_SYSTEM_PROMPT },
            { role: 'user', content: userMessage }
        ],
        stream: true,
    });

    for await (const chunk of enhancerStream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
            sendEvent('enhancing_content', { text: delta.content });
            enhancedPrompt += delta.content;
        }
    }

    sendEvent('phase_end', { phase: 'enhancing' });

    // Phase 2: Executing
    sendEvent('phase_start', { phase: 'executing', model: config.executingModel });

    const executingHistory: ChatMessage[] = [
        { role: 'system', content: EXECUTING_SYSTEM_PROMPT },
        { role: 'user', content: enhancedPrompt }
    ];

    await processExecutingChat(client, config, executingHistory, sendEvent);

    sendEvent('phase_end', { phase: 'executing' });
}

// Single-mode processing
async function processSingleModeChat(
    client: OpenAI,
    config: Config,
    history: ChatMessage[],
    sendEvent: (type: string, data: any) => void,
    autoApprove: boolean
) {
    let finishedTurn = false;

    while (!finishedTurn) {
        const stream = await client.chat.completions.create({
            model: config.model,
            messages: history as any,
            tools: toolsDefinition as any,
            tool_choice: 'auto',
            stream: true,
        });

        let fullContent = '';
        let toolCalls: StreamedToolCall[] = [];
        let currentToolCallIndex = -1;

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
                sendEvent('content', { text: delta.content });
                fullContent += delta.content;
            }

            if (delta.tool_calls) {
                for (const toolCallDelta of delta.tool_calls) {
                    const index = toolCallDelta.index;
                    if (index !== currentToolCallIndex) {
                        currentToolCallIndex = index;
                        if (!toolCalls[index]) {
                            toolCalls[index] = { id: toolCallDelta.id || '', type: 'function', function: { name: '', arguments: '' } };
                        }
                    }
                    if (toolCallDelta.id) toolCalls[index].id = toolCallDelta.id;
                    if (toolCallDelta.function?.name) toolCalls[index].function.name += toolCallDelta.function.name;
                    if (toolCallDelta.function?.arguments) toolCalls[index].function.arguments += toolCallDelta.function.arguments;
                }
            }
        }

        // Check if model output tool calls as text (fallback for models without native function calling)
        if (toolCalls.length === 0 && fullContent) {
            const parsedTools = parseTextToolCalls(fullContent);
            if (parsedTools.length > 0) {
                toolCalls = parsedTools;
            }
        }

        const assistantMessage: ChatMessage = { role: 'assistant', content: fullContent || null };
        if (toolCalls.length > 0) (assistantMessage as any).tool_calls = toolCalls;
        history.push(assistantMessage);

        if (toolCalls.length > 0) {
            for (const toolCall of toolCalls) {
                await executeToolAndSendEvents(toolCall, history, sendEvent);
            }
        } else {
            finishedTurn = true;
        }
    }
}

// Executing phase for dual-mode
async function processExecutingChat(
    client: OpenAI,
    config: Config,
    history: ChatMessage[],
    sendEvent: (type: string, data: any) => void
) {
    let finishedTurn = false;

    while (!finishedTurn) {
        const stream = await client.chat.completions.create({
            model: config.executingModel,
            messages: history as any,
            tools: toolsDefinition as any,
            tool_choice: 'auto',
            stream: true,
        });

        let fullContent = '';
        let toolCalls: StreamedToolCall[] = [];
        let currentToolCallIndex = -1;

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
                sendEvent('content', { text: delta.content });
                fullContent += delta.content;
            }

            if (delta.tool_calls) {
                for (const toolCallDelta of delta.tool_calls) {
                    const index = toolCallDelta.index;
                    if (index !== currentToolCallIndex) {
                        currentToolCallIndex = index;
                        if (!toolCalls[index]) {
                            toolCalls[index] = { id: toolCallDelta.id || '', type: 'function', function: { name: '', arguments: '' } };
                        }
                    }
                    if (toolCallDelta.id) toolCalls[index].id = toolCallDelta.id;
                    if (toolCallDelta.function?.name) toolCalls[index].function.name += toolCallDelta.function.name;
                    if (toolCallDelta.function?.arguments) toolCalls[index].function.arguments += toolCallDelta.function.arguments;
                }
            }
        }

        // Check if model output tool calls as text (fallback for models without native function calling)
        if (toolCalls.length === 0 && fullContent) {
            const parsedTools = parseTextToolCalls(fullContent);
            if (parsedTools.length > 0) {
                toolCalls = parsedTools;
            }
        }

        const assistantMessage: ChatMessage = { role: 'assistant', content: fullContent || null };
        if (toolCalls.length > 0) (assistantMessage as any).tool_calls = toolCalls;
        history.push(assistantMessage);

        if (toolCalls.length > 0) {
            for (const toolCall of toolCalls) {
                await executeToolAndSendEvents(toolCall, history, sendEvent);
            }
        } else {
            finishedTurn = true;
        }
    }
}

// Shared tool execution
async function executeToolAndSendEvents(
    toolCall: StreamedToolCall,
    history: ChatMessage[],
    sendEvent: (type: string, data: any) => void
) {
    const fnName = toolCall.function.name;
    let args: any = {};

    try {
        args = JSON.parse(toolCall.function.arguments);
    } catch (e) {
        sendEvent('tool_error', { name: fnName, error: 'Failed to parse arguments' });
        history.push({ role: 'tool', tool_call_id: toolCall.id, content: 'Error: Failed to parse tool arguments' });
        return;
    }

    sendEvent('tool_start', { name: fnName, args });

    try {
        let result = '';
        if (fnName === 'list_files') result = await listFiles(args.dir_path);
        else if (fnName === 'read_file') result = await readFile(args.file_path);
        else if (fnName === 'write_file') result = await writeFile(args.file_path, args.content);
        else if (fnName === 'run_shell_command') result = await runShellCommand(args.command);
        else result = 'Error: Unknown tool function';

        // Send truncated result for display (5000 chars), but keep full result for AI
        const displayResult = result.length > 5000
            ? result.substring(0, 5000) + '\n... (truncated)'
            : result;
        sendEvent('tool_result', { name: fnName, result: displayResult });
        history.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
    } catch (err: any) {
        sendEvent('tool_error', { name: fnName, error: err.message });
        history.push({ role: 'tool', tool_call_id: toolCall.id, content: `Error: ${err.message}` });
    }
}

// Parse tool calls from text output (for models that don't support native function calling)
function parseTextToolCalls(content: string): StreamedToolCall[] {
    const toolCalls: StreamedToolCall[] = [];

    // Pattern 1: ```tool_request\n{...}\n``` or ```json\n{"name": "...", ...}\n```
    const codeBlockRegex = /```(?:tool_request|json)?\s*\n?\{[^`]*"name"\s*:\s*"([^"]+)"[^`]*"arguments"\s*:\s*(\{[^`]*\})/gi;

    // Pattern 2: {"name": "tool_name", "arguments": {...}} directly in text
    const jsonRegex = /\{"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^}]+\})\}/g;

    let match;
    let id = 0;

    // Try code block pattern first
    while ((match = codeBlockRegex.exec(content)) !== null) {
        try {
            const name = match[1];
            const args = match[2];
            JSON.parse(args); // Validate JSON
            toolCalls.push({
                id: `text-tool-${id++}`,
                type: 'function',
                function: { name, arguments: args }
            });
        } catch (e) {
            // Invalid JSON, skip
        }
    }

    // If no code blocks found, try direct JSON pattern
    if (toolCalls.length === 0) {
        while ((match = jsonRegex.exec(content)) !== null) {
            try {
                const name = match[1];
                const args = match[2];
                JSON.parse(args); // Validate JSON
                toolCalls.push({
                    id: `text-tool-${id++}`,
                    type: 'function',
                    function: { name, arguments: args }
                });
            } catch (e) {
                // Invalid JSON, skip
            }
        }
    }

    return toolCalls;
}
