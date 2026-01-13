import express from 'express';
import cors from 'cors';
import path from 'path';
import { OpenAI } from 'openai';
import { Config, createClient, selectModel } from './config';
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

// Store chat sessions
const sessions: Map<string, ChatMessage[]> = new Map();

const SYSTEM_PROMPT = `You are a skilled software engineer helping with coding tasks. You have access to tools for reading/writing files and running shell commands.

CRITICAL COMMUNICATION RULES:
- ALWAYS explain what you're about to do BEFORE using any tool. Never use tools silently.
- While working, narrate your thought process: "I'll create the file structure first...", "Now let me add the main logic...", "Let me check if that worked..."
- After completing a task, briefly summarize what you did.

BEHAVIOR RULES:
- Do NOT introduce yourself. Just start helping.
- Be conversational but concise - like a coworker explaining as they code.
- When writing code, explain key parts: "This function handles...", "I'm using X because..."
- If something fails, explain what went wrong and how you'll fix it.
- When creating a NEW PROJECT, ALWAYS create a dedicated folder first (use kebab-case naming).

EXAMPLE FLOW:
User: "Create a hello world python script"
You: "I'll create a simple Python script for you. Let me first check the current directory, then create the file.
[uses list_files]
Alright, I see the directory structure. Now I'll create hello.py with a basic print statement.
[uses write_file]
Done! I've created hello.py. You can run it with: python hello.py"`;


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
        res.json({ model: config.model, baseURL: config.baseURL });
    });

    // Update model
    app.post('/api/config/model', (req, res) => {
        const { model } = req.body;
        if (model) {
            config.model = model;
            res.json({ success: true, model });
        } else {
            res.status(400).json({ error: 'Model name required' });
        }
    });

    // Chat endpoint with streaming
    app.post('/api/chat', async (req, res) => {
        const { message, sessionId = 'default', autoApprove = false } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message required' });
        }

        // Get or create session
        if (!sessions.has(sessionId)) {
            sessions.set(sessionId, [{ role: 'system', content: SYSTEM_PROMPT }]);
        }
        const history = sessions.get(sessionId)!;
        history.push({ role: 'user', content: message });

        // Set up SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const sendEvent = (type: string, data: any) => {
            res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        };

        try {
            await processChat(client, config, history, sendEvent, autoApprove);
            sendEvent('done', {});
        } catch (error: any) {
            sendEvent('error', { message: error.message });
        }

        res.end();
    });

    // Execute tool manually (for user approval)
    app.post('/api/tool/execute', async (req, res) => {
        const { toolName, args, sessionId = 'default', toolCallId } = req.body;

        try {
            let result = '';
            if (toolName === 'list_files') {
                result = await listFiles(args.dir_path);
            } else if (toolName === 'read_file') {
                result = await readFile(args.file_path);
            } else if (toolName === 'write_file') {
                result = await writeFile(args.file_path, args.content);
            } else if (toolName === 'run_shell_command') {
                result = await runShellCommand(args.command);
            } else {
                result = 'Error: Unknown tool function';
            }

            // Add to history if sessionId provided
            if (sessions.has(sessionId) && toolCallId) {
                const history = sessions.get(sessionId)!;
                history.push({
                    role: 'tool',
                    tool_call_id: toolCallId,
                    content: result,
                });
            }

            res.json({ success: true, result });
        } catch (error: any) {
            res.json({ success: false, error: error.message });
        }
    });

    // Clear session
    app.post('/api/session/clear', (req, res) => {
        const { sessionId = 'default' } = req.body;
        sessions.set(sessionId, [{ role: 'system', content: SYSTEM_PROMPT }]);
        res.json({ success: true });
    });

    app.listen(port, () => {
        console.log(`\n🌐 Web GUI running at http://localhost:${port}`);
        console.log(`   Model: ${config.model}`);
        console.log(`   LM Studio: ${config.baseURL}\n`);
    });
}

async function processChat(
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
                            toolCalls[index] = {
                                id: toolCallDelta.id || '',
                                type: 'function',
                                function: { name: '', arguments: '' }
                            };
                        }
                    }

                    if (toolCallDelta.id) {
                        toolCalls[index].id = toolCallDelta.id;
                    }
                    if (toolCallDelta.function?.name) {
                        toolCalls[index].function.name += toolCallDelta.function.name;
                    }
                    if (toolCallDelta.function?.arguments) {
                        toolCalls[index].function.arguments += toolCallDelta.function.arguments;
                    }
                }
            }
        }

        // Build assistant message
        const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: fullContent || null,
        };
        if (toolCalls.length > 0) {
            (assistantMessage as any).tool_calls = toolCalls;
        }
        history.push(assistantMessage);

        // Process tool calls
        if (toolCalls.length > 0) {
            for (const toolCall of toolCalls) {
                const fnName = toolCall.function.name;
                let args: any = {};

                try {
                    args = JSON.parse(toolCall.function.arguments);
                } catch (e) {
                    sendEvent('tool_error', { name: fnName, error: 'Failed to parse arguments' });
                    history.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: 'Error: Failed to parse tool arguments',
                    });
                    continue;
                }

                const needsApproval = fnName === 'write_file' || fnName === 'run_shell_command';

                if (needsApproval && !autoApprove) {
                    // Send approval request and wait
                    sendEvent('tool_approval', {
                        id: toolCall.id,
                        name: fnName,
                        args,
                        requiresApproval: true
                    });
                    // The client will need to call /api/tool/execute manually
                    // For now, we'll auto-approve in web mode for simplicity
                }

                sendEvent('tool_start', { name: fnName, args });

                try {
                    let result = '';
                    if (fnName === 'list_files') {
                        result = await listFiles(args.dir_path);
                    } else if (fnName === 'read_file') {
                        result = await readFile(args.file_path);
                    } else if (fnName === 'write_file') {
                        result = await writeFile(args.file_path, args.content);
                    } else if (fnName === 'run_shell_command') {
                        result = await runShellCommand(args.command);
                    } else {
                        result = 'Error: Unknown tool function';
                    }

                    sendEvent('tool_result', { name: fnName, result: result.substring(0, 1000) });

                    history.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: result,
                    });
                } catch (err: any) {
                    sendEvent('tool_error', { name: fnName, error: err.message });
                    history.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: `Error: ${err.message}`,
                    });
                }
            }
        } else {
            finishedTurn = true;
        }
    }
}
