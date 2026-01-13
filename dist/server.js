"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWebServer = startWebServer;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const config_1 = require("./config");
const tools_1 = require("./tools");
// Store chat sessions
const sessions = new Map();
const SYSTEM_PROMPT = `You are a skilled software engineer helping with coding tasks. You have access to tools for reading/writing files and running shell commands.

RULES:
- Do NOT introduce yourself or explain your role. Just help directly.
- Be concise. Get straight to the point.
- Use tools when needed - read files, write code, run commands.
- Briefly explain what you're doing before using tools.
- When writing code, include a short explanation of what it does.
- If unsure about the directory structure, use list_files first.
- IMPORTANT: When creating a NEW PROJECT, ALWAYS create a dedicated folder for it first. Name the folder appropriately (e.g., "my-react-app", "python-api", etc.). Never scatter project files in the current directory.
- When creating project folders, use lowercase with hyphens for naming (kebab-case).`;
async function startWebServer(config) {
    const app = (0, express_1.default)();
    const port = process.env.PORT || 3000;
    app.use((0, cors_1.default)());
    app.use(express_1.default.json());
    app.use(express_1.default.static(path_1.default.join(__dirname, '../public')));
    const client = (0, config_1.createClient)(config);
    // Get available models
    app.get('/api/models', async (req, res) => {
        try {
            const response = await fetch(`${config.baseURL}/models`);
            const data = await response.json();
            res.json(data);
        }
        catch (error) {
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
        }
        else {
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
        const history = sessions.get(sessionId);
        history.push({ role: 'user', content: message });
        // Set up SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        const sendEvent = (type, data) => {
            res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        };
        try {
            await processChat(client, config, history, sendEvent, autoApprove);
            sendEvent('done', {});
        }
        catch (error) {
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
                result = await (0, tools_1.listFiles)(args.dir_path);
            }
            else if (toolName === 'read_file') {
                result = await (0, tools_1.readFile)(args.file_path);
            }
            else if (toolName === 'write_file') {
                result = await (0, tools_1.writeFile)(args.file_path, args.content);
            }
            else if (toolName === 'run_shell_command') {
                result = await (0, tools_1.runShellCommand)(args.command);
            }
            else {
                result = 'Error: Unknown tool function';
            }
            // Add to history if sessionId provided
            if (sessions.has(sessionId) && toolCallId) {
                const history = sessions.get(sessionId);
                history.push({
                    role: 'tool',
                    tool_call_id: toolCallId,
                    content: result,
                });
            }
            res.json({ success: true, result });
        }
        catch (error) {
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
async function processChat(client, config, history, sendEvent, autoApprove) {
    let finishedTurn = false;
    while (!finishedTurn) {
        const stream = await client.chat.completions.create({
            model: config.model,
            messages: history,
            tools: tools_1.toolsDefinition,
            tool_choice: 'auto',
            stream: true,
        });
        let fullContent = '';
        let toolCalls = [];
        let currentToolCallIndex = -1;
        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (!delta)
                continue;
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
        const assistantMessage = {
            role: 'assistant',
            content: fullContent || null,
        };
        if (toolCalls.length > 0) {
            assistantMessage.tool_calls = toolCalls;
        }
        history.push(assistantMessage);
        // Process tool calls
        if (toolCalls.length > 0) {
            for (const toolCall of toolCalls) {
                const fnName = toolCall.function.name;
                let args = {};
                try {
                    args = JSON.parse(toolCall.function.arguments);
                }
                catch (e) {
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
                        result = await (0, tools_1.listFiles)(args.dir_path);
                    }
                    else if (fnName === 'read_file') {
                        result = await (0, tools_1.readFile)(args.file_path);
                    }
                    else if (fnName === 'write_file') {
                        result = await (0, tools_1.writeFile)(args.file_path, args.content);
                    }
                    else if (fnName === 'run_shell_command') {
                        result = await (0, tools_1.runShellCommand)(args.command);
                    }
                    else {
                        result = 'Error: Unknown tool function';
                    }
                    sendEvent('tool_result', { name: fnName, result: result.substring(0, 1000) });
                    history.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: result,
                    });
                }
                catch (err) {
                    sendEvent('tool_error', { name: fnName, error: err.message });
                    history.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: `Error: ${err.message}`,
                    });
                }
            }
        }
        else {
            finishedTurn = true;
        }
    }
}
