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

const EXECUTING_SYSTEM_PROMPT = `You are a skilled software engineer with access to these tools:
- list_files: List files in a directory
- read_file: Read file contents  
- write_file: Create or overwrite files
- run_shell_command: Execute shell commands

You will receive a detailed prompt describing what to build. Your job is to ACTUALLY BUILD IT using your tools.

CRITICAL: You MUST use your tools to create real files. Do not just describe what to do - DO IT.

WORKFLOW:
1. First, use list_files to see the current directory
2. Create any needed folders with run_shell_command (e.g., "mkdir my-project")
3. Use write_file to create each file with real code
4. Use run_shell_command for any setup (npm init, pip install, etc.)
5. Summarize what you created

RULES:
- Narrate as you work: "Creating the folder...", "Writing the main file..."
- ALWAYS use write_file to create files - never just show code blocks
- Create project folders using kebab-case naming
- If something fails, explain and retry`;

const SINGLE_MODEL_PROMPT = `You are a skilled software engineer helping with coding tasks. You have access to tools for reading/writing files and running shell commands.

CRITICAL COMMUNICATION RULES:
- ALWAYS explain what you're about to do BEFORE using any tool. Never use tools silently.
- While working, narrate your thought process: "I'll create the file structure first...", "Now let me add the main logic..."
- After completing a task, briefly summarize what you did.

BEHAVIOR RULES:
- Do NOT introduce yourself. Just start helping.
- Be conversational but concise - like a coworker explaining as they code.
- When writing code, explain key parts: "This function handles...", "I'm using X because..."
- If something fails, explain what went wrong and how you'll fix it.
- When creating a NEW PROJECT, ALWAYS create a dedicated folder first (use kebab-case naming).`;

export async function startWebServer(config: Config) {
    const app = express();
    const port = process.env.PORT || 3000;

    app.use(cors());
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '../public')));

    const client = createClient(config);

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
            res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        };

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
            sendEvent('done', {});
        } catch (error: any) {
            sendEvent('error', { message: error.message });
        }

        res.end();
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

        sendEvent('tool_result', { name: fnName, result: result.substring(0, 1000) });
        history.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
    } catch (err: any) {
        sendEvent('tool_error', { name: fnName, error: err.message });
        history.push({ role: 'tool', tool_call_id: toolCall.id, content: `Error: ${err.message}` });
    }
}
