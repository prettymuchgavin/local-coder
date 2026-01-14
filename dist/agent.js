"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAgent = runAgent;
const prompts_1 = require("@inquirer/prompts");
const ora_1 = __importDefault(require("ora"));
const chalk_1 = __importDefault(require("chalk"));
const tools_1 = require("./tools");
const config_1 = require("./config");
// Stylized ASCII banner
const BANNER = `
${chalk_1.default.cyan('╔═══════════════════════════════════════════════════════════════╗')}
${chalk_1.default.cyan('║')}  ${chalk_1.default.bold.white('██╗      ██████╗  ██████╗ █████╗ ██╗')}      ${chalk_1.default.bold.magenta('██████╗ ██████╗')}  ${chalk_1.default.cyan('║')}
${chalk_1.default.cyan('║')}  ${chalk_1.default.bold.white('██║     ██╔═══██╗██╔════╝██╔══██╗██║')}     ${chalk_1.default.bold.magenta('██╔════╝██╔═══██╗')} ${chalk_1.default.cyan('║')}
${chalk_1.default.cyan('║')}  ${chalk_1.default.bold.white('██║     ██║   ██║██║     ███████║██║')}     ${chalk_1.default.bold.magenta('██║     ██║   ██║')} ${chalk_1.default.cyan('║')}
${chalk_1.default.cyan('║')}  ${chalk_1.default.bold.white('██║     ██║   ██║██║     ██╔══██║██║')}     ${chalk_1.default.bold.magenta('██║     ██║   ██║')} ${chalk_1.default.cyan('║')}
${chalk_1.default.cyan('║')}  ${chalk_1.default.bold.white('███████╗╚██████╔╝╚██████╗██║  ██║███████╗')} ${chalk_1.default.bold.magenta('╚██████╗╚██████╔╝')} ${chalk_1.default.cyan('║')}
${chalk_1.default.cyan('║')}  ${chalk_1.default.bold.white('╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝')}  ${chalk_1.default.bold.magenta('╚═════╝ ╚═════╝')} ${chalk_1.default.cyan('║')}
${chalk_1.default.cyan('╠═══════════════════════════════════════════════════════════════╣')}
${chalk_1.default.cyan('║')}  ${chalk_1.default.dim('Your AI-powered local coding assistant')}                        ${chalk_1.default.cyan('║')}
${chalk_1.default.cyan('╚═══════════════════════════════════════════════════════════════╝')}
`;
// System prompts
const ENHANCER_SYSTEM_PROMPT = `# Enhanced AI Prompt Generator

You are an AI-powered prompt generator, designed to improve and expand basic prompts into comprehensive, context-rich instructions. Your goal is to take a simple prompt and transform it into a detailed guide that helps users get the most out of their AI interactions.

## Your process:

1. Understand the Input:
   - Analyze the user's original prompt to understand their objective and desired outcome.
   - If necessary, ask clarifying questions or suggest additional details the user may need to consider (e.g., context, target audience, specific goals).

2. Refine the Prompt:
   - Expand on the original prompt by providing detailed instructions.
   - Break down the enhanced prompt into clear steps or sections.
   - Include useful examples where appropriate.
   - Ensure the improved prompt offers specific actions, such as steps the AI should follow or specific points it should address.
   - Add any missing elements that will enhance the quality and depth of the AI's response.

3. Offer Expertise and Solutions:
   - Tailor the refined prompt to the subject matter of the input, ensuring the AI focuses on key aspects relevant to the topic.
   - Provide real-world examples, use cases, or scenarios to illustrate how the AI can best respond to the prompt.
   - Ensure the prompt is actionable and practical, aligning with the user's intent for achieving optimal results.

4. Structure the Enhanced Prompt:
   - Use clear sections, including:
     - Role definition
     - Key responsibilities
     - Approach or methodology
     - Specific tasks or actions
     - Additional considerations or tips
   - Use bullet points and subheadings for clarity and readability.

5. Review and Refine:
   - Ensure the expanded prompt provides concrete examples and actionable instructions.
   - Maintain a professional and authoritative tone throughout the enhanced prompt.
   - Check that all aspects of the original prompt are addressed and expanded upon.

## Output format:

Present the enhanced prompt as a well-structured, detailed guide that an AI can follow to effectively perform the requested role or task. Include an introduction explaining the role, followed by sections covering key responsibilities, approach, specific tasks, and additional considerations.

Only provide the output prompt. Do not add your own comments before the prompt first.`;
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
const SINGLE_MODEL_SYSTEM_PROMPT = `You are a skilled software engineer. You have function calling capabilities to interact with the file system.

Your available functions are: list_files, read_file, write_file, run_shell_command

IMPORTANT: Do NOT write out tool calls as text or JSON. The system handles tool invocation automatically. Just describe what you want to do and use the functions naturally.

RULES:
- Explain what you're doing as you work
- Be conversational but concise
- When creating a NEW PROJECT, create a dedicated folder first (use kebab-case naming)
- If something fails, explain and fix it`;
function printDivider() {
    console.log(chalk_1.default.dim('─'.repeat(65)));
}
function printBox(title, content, color = chalk_1.default.cyan) {
    const lines = content.split('\n');
    const maxLen = Math.max(title.length, ...lines.map(l => l.length));
    const width = Math.min(maxLen + 4, 63);
    console.log(color(`┌─ ${title} ${'─'.repeat(Math.max(0, width - title.length - 4))}┐`));
    for (const line of lines) {
        console.log(color('│ ') + line.padEnd(width - 2) + color(' │'));
    }
    console.log(color('└' + '─'.repeat(width) + '┘'));
}
async function runAgent(config) {
    const client = (0, config_1.createClient)(config);
    // Display stylized banner
    console.log(BANNER);
    // Connection info
    console.log(chalk_1.default.green('  ✓ ') + chalk_1.default.white('Connected to LM Studio'));
    console.log(chalk_1.default.dim(`    Endpoint: ${config.baseURL}`));
    if (config.dualMode) {
        console.log(chalk_1.default.magenta(`    ✨ Enhancer: ${config.thinkingModel}`));
        console.log(chalk_1.default.cyan(`    ⚡ Executor: ${config.executingModel}`));
    }
    else {
        console.log(chalk_1.default.dim(`    Model:    ${config.model}`));
    }
    console.log('');
    printDivider();
    console.log(chalk_1.default.dim('  Commands: ') + chalk_1.default.yellow('exit') + chalk_1.default.dim(' or ') + chalk_1.default.yellow('quit') + chalk_1.default.dim(' to end session'));
    if (config.dualMode) {
        console.log(chalk_1.default.dim('  Mode: ') + chalk_1.default.magenta('Dual-Model') + chalk_1.default.dim(' (enhancer + executor)'));
    }
    console.log(chalk_1.default.dim('  Tip: Ask me to create projects, write code, or debug issues!'));
    printDivider();
    console.log('');
    // Initialize history with system prompt once
    const history = [
        { role: 'system', content: SINGLE_MODEL_SYSTEM_PROMPT }
    ];
    // Dual mode maintains its own persistent history
    const dualModeHistory = [];
    while (true) {
        const userMessage = await (0, prompts_1.input)({
            message: chalk_1.default.green('❯'),
            theme: {
                prefix: chalk_1.default.bold.cyan(' YOU '),
            }
        });
        if (userMessage.toLowerCase() === 'exit' || userMessage.toLowerCase() === 'quit') {
            console.log('');
            printDivider();
            console.log(chalk_1.default.yellow('  👋 Goodbye! Happy coding!'));
            printDivider();
            break;
        }
        if (!userMessage.trim()) {
            continue;
        }
        if (config.dualMode) {
            await processDualModelTurn(client, config, userMessage, dualModeHistory);
        }
        else {
            // Single model: add user message to persistent history
            history.push({ role: 'user', content: userMessage });
            await processSingleModelTurn(client, config, history);
        }
    }
}
// Dual-model processing with persistent history
async function processDualModelTurn(client, config, userMessage, dualModeHistory) {
    // Phase 1: Enhancing the prompt
    console.log('');
    console.log(chalk_1.default.magenta.bold('  ┌─ ✨ ENHANCING PROMPT ──────────────────────────────────────┐'));
    let enhancedPrompt = '';
    let showFullEnhanced = false;
    try {
        const enhancerStream = await client.chat.completions.create({
            model: config.thinkingModel,
            messages: [
                { role: 'system', content: ENHANCER_SYSTEM_PROMPT },
                { role: 'user', content: userMessage }
            ],
            stream: true,
        });
        let enhancedContent = '';
        const enhancerSpinner = (0, ora_1.default)({
            text: 'Enhancing your prompt...',
            prefixText: '  ',
            color: 'magenta'
        }).start();
        for await (const chunk of enhancerStream) {
            const delta = chunk.choices[0]?.delta;
            if (delta?.content) {
                enhancedContent += delta.content;
            }
        }
        enhancerSpinner.stop();
        enhancedPrompt = enhancedContent;
        // Show a preview of the enhanced prompt
        const lines = enhancedPrompt.split('\n').filter(l => l.trim());
        const preview = lines.slice(0, 8);
        console.log(chalk_1.default.magenta('  │'));
        for (const line of preview) {
            console.log(chalk_1.default.magenta('  │ ') + chalk_1.default.dim(line.substring(0, 58)));
        }
        if (lines.length > 8) {
            console.log(chalk_1.default.magenta('  │ ') + chalk_1.default.dim(`... (${lines.length - 8} more lines)`));
        }
        console.log(chalk_1.default.magenta('  │'));
        console.log(chalk_1.default.magenta('  └────────────────────────────────────────────────────────────┘'));
        showFullEnhanced = await (0, prompts_1.confirm)({
            message: chalk_1.default.dim('  Show full enhanced prompt?'),
            default: false
        });
        if (showFullEnhanced) {
            console.log('');
            console.log(chalk_1.default.dim('  ┌─ Enhanced Prompt ───────────────────────────────────────────┐'));
            for (const line of enhancedPrompt.split('\n')) {
                console.log(chalk_1.default.dim('  │ ') + line.substring(0, 58));
            }
            console.log(chalk_1.default.dim('  └────────────────────────────────────────────────────────────┘'));
        }
    }
    catch (error) {
        console.log(chalk_1.default.magenta('  │ ') + chalk_1.default.red(`Error: ${error.message}`));
        console.log(chalk_1.default.magenta('  └────────────────────────────────────────────────────────────┘'));
        return;
    }
    // Ask to proceed with execution
    const proceed = await (0, prompts_1.confirm)({
        message: chalk_1.default.cyan('  Execute with enhanced prompt?'),
        default: true
    });
    if (!proceed) {
        console.log(chalk_1.default.yellow('  Cancelled.'));
        return;
    }
    // Phase 2: Executing with persistent history
    console.log('');
    console.log(chalk_1.default.cyan.bold('  ┌─ ⚡ EXECUTING ────────────────────────────────────────────┐'));
    console.log(chalk_1.default.cyan('  │'));
    // Initialize history with system prompt if empty
    if (dualModeHistory.length === 0) {
        dualModeHistory.push({ role: 'system', content: EXECUTING_SYSTEM_PROMPT });
    }
    // Add the enhanced prompt as user message
    dualModeHistory.push({ role: 'user', content: enhancedPrompt });
    await processExecutingPhase(client, config, dualModeHistory);
    console.log(chalk_1.default.cyan('  │'));
    console.log(chalk_1.default.cyan('  └────────────────────────────────────────────────────────────┘'));
}
// Single model processing (existing logic)
async function processSingleModelTurn(client, config, history) {
    let finishedTurn = false;
    while (!finishedTurn) {
        console.log('');
        process.stdout.write(chalk_1.default.bold.magenta(' AI ') + chalk_1.default.magenta('┃ '));
        try {
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
            let atLineStart = false; // First line already has prefix
            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta;
                if (!delta)
                    continue;
                if (delta.content) {
                    // Print prefix only at line start
                    const lines = delta.content.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (atLineStart && lines[i]) {
                            process.stdout.write(chalk_1.default.magenta('    ┃ '));
                        }
                        process.stdout.write(lines[i]);
                        if (i < lines.length - 1) {
                            process.stdout.write('\n');
                            atLineStart = true;
                        }
                        else {
                            atLineStart = lines[i] === '';
                        }
                    }
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
                        if (toolCallDelta.id)
                            toolCalls[index].id = toolCallDelta.id;
                        if (toolCallDelta.function?.name)
                            toolCalls[index].function.name += toolCallDelta.function.name;
                        if (toolCallDelta.function?.arguments)
                            toolCalls[index].function.arguments += toolCallDelta.function.arguments;
                    }
                }
            }
            if (fullContent && !atLineStart)
                console.log('');
            // Check if model output tool calls as text (fallback for models without native function calling)
            if (toolCalls.length === 0 && fullContent) {
                const parsedTools = parseTextToolCalls(fullContent);
                if (parsedTools.length > 0) {
                    toolCalls = parsedTools;
                }
            }
            const assistantMessage = { role: 'assistant', content: fullContent || null };
            if (toolCalls.length > 0)
                assistantMessage.tool_calls = toolCalls;
            history.push(assistantMessage);
            if (toolCalls.length > 0) {
                for (const toolCall of toolCalls) {
                    await executeToolCall(toolCall, history);
                }
            }
            else {
                finishedTurn = true;
            }
        }
        catch (error) {
            console.log(chalk_1.default.red(`\n  ❌ Error: ${error.message}`));
            finishedTurn = true;
        }
    }
}
// Executing phase for dual-model
async function processExecutingPhase(client, config, history) {
    let finishedTurn = false;
    while (!finishedTurn) {
        try {
            const stream = await client.chat.completions.create({
                model: config.executingModel,
                messages: history,
                tools: tools_1.toolsDefinition,
                tool_choice: 'auto',
                stream: true,
            });
            let fullContent = '';
            let toolCalls = [];
            let currentToolCallIndex = -1;
            let atLineStart = true;
            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta;
                if (!delta)
                    continue;
                if (delta.content) {
                    // Print prefix only at line start
                    const lines = delta.content.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (atLineStart && lines[i]) {
                            process.stdout.write(chalk_1.default.cyan('  │ '));
                        }
                        process.stdout.write(lines[i]);
                        if (i < lines.length - 1) {
                            process.stdout.write('\n');
                            atLineStart = true;
                        }
                        else {
                            atLineStart = lines[i] === '';
                        }
                    }
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
                        if (toolCallDelta.id)
                            toolCalls[index].id = toolCallDelta.id;
                        if (toolCallDelta.function?.name)
                            toolCalls[index].function.name += toolCallDelta.function.name;
                        if (toolCallDelta.function?.arguments)
                            toolCalls[index].function.arguments += toolCallDelta.function.arguments;
                    }
                }
            }
            if (fullContent && !atLineStart)
                console.log('');
            // Check if model output tool calls as text (fallback for models without native function calling)
            if (toolCalls.length === 0 && fullContent) {
                const parsedTools = parseTextToolCalls(fullContent);
                if (parsedTools.length > 0) {
                    toolCalls = parsedTools;
                }
            }
            const assistantMessage = { role: 'assistant', content: fullContent || null };
            if (toolCalls.length > 0)
                assistantMessage.tool_calls = toolCalls;
            history.push(assistantMessage);
            if (toolCalls.length > 0) {
                for (const toolCall of toolCalls) {
                    await executeToolCall(toolCall, history, '  ');
                }
            }
            else {
                finishedTurn = true;
            }
        }
        catch (error) {
            console.log(chalk_1.default.red(`\n  │ ❌ Error: ${error.message}`));
            finishedTurn = true;
        }
    }
}
// Parse tool calls from text output (for models that don't support native function calling)
function parseTextToolCalls(content) {
    const toolCalls = [];
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
        }
        catch (e) {
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
            }
            catch (e) {
                // Invalid JSON, skip
            }
        }
    }
    return toolCalls;
}
// Shared tool execution
async function executeToolCall(toolCall, history, indent = '') {
    const fnName = toolCall.function.name;
    let args = {};
    try {
        args = JSON.parse(toolCall.function.arguments);
    }
    catch (e) {
        console.log(chalk_1.default.red(`${indent}⚠ Failed to parse tool arguments`));
        history.push({ role: 'tool', tool_call_id: toolCall.id, content: 'Error: Failed to parse tool arguments' });
        return;
    }
    console.log('');
    console.log(chalk_1.default.yellow(`${indent}┌─ 🔧 ${fnName} ─────────────────────────────────────────┐`));
    const argsStr = JSON.stringify(args, null, 2);
    for (const line of argsStr.split('\n').slice(0, 5)) {
        console.log(chalk_1.default.yellow(`${indent}│ `) + chalk_1.default.dim(line));
    }
    console.log(chalk_1.default.yellow(`${indent}└────────────────────────────────────────────────────────┘`));
    let allowed = true;
    if (fnName === 'write_file' || fnName === 'run_shell_command') {
        allowed = await (0, prompts_1.confirm)({ message: chalk_1.default.yellow(`${indent}Execute?`), default: true });
    }
    let result = '';
    if (allowed) {
        const spinner = (0, ora_1.default)({ text: `Executing ${fnName}...`, prefixText: indent, color: 'yellow' }).start();
        try {
            if (fnName === 'list_files')
                result = await (0, tools_1.listFiles)(args.dir_path);
            else if (fnName === 'read_file')
                result = await (0, tools_1.readFile)(args.file_path);
            else if (fnName === 'write_file')
                result = await (0, tools_1.writeFile)(args.file_path, args.content);
            else if (fnName === 'run_shell_command')
                result = await (0, tools_1.runShellCommand)(args.command);
            else
                result = 'Error: Unknown tool';
            spinner.succeed(chalk_1.default.green(`${fnName} ✓`));
        }
        catch (err) {
            spinner.fail(chalk_1.default.red(`${fnName} failed`));
            result = `Error: ${err.message}`;
        }
    }
    else {
        result = 'Tool execution denied by user.';
        console.log(chalk_1.default.yellow(`${indent}Cancelled`));
    }
    history.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
}
