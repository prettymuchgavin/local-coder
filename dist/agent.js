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
    const history = [
        {
            role: 'system',
            content: `You are a skilled software engineer helping with coding tasks. You have access to tools for reading/writing files and running shell commands.

RULES:
- Do NOT introduce yourself or explain your role. Just help directly.
- Be concise. Get straight to the point.
- Use tools when needed - read files, write code, run commands.
- Briefly explain what you're doing before using tools.
- When writing code, include a short explanation of what it does.
- If unsure about the directory structure, use list_files first.
- IMPORTANT: When creating a NEW PROJECT, ALWAYS create a dedicated folder for it first. Name the folder appropriately (e.g., "my-react-app", "python-api", etc.). Never scatter project files in the current directory.
- When creating project folders, use lowercase with hyphens for naming (kebab-case).`,
        },
    ];
    // Display stylized banner
    console.log(BANNER);
    // Connection info box
    console.log(chalk_1.default.green('  ✓ ') + chalk_1.default.white('Connected to LM Studio'));
    console.log(chalk_1.default.dim(`    Endpoint: ${config.baseURL}`));
    console.log(chalk_1.default.dim(`    Model:    ${config.model}`));
    console.log('');
    printDivider();
    console.log(chalk_1.default.dim('  Commands: ') + chalk_1.default.yellow('exit') + chalk_1.default.dim(' or ') + chalk_1.default.yellow('quit') + chalk_1.default.dim(' to end session'));
    console.log(chalk_1.default.dim('  Tip: Ask me to create projects, write code, or debug issues!'));
    printDivider();
    console.log('');
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
        history.push({ role: 'user', content: userMessage });
        await processTurn(client, config, history);
    }
}
async function processTurn(client, config, history) {
    let finishedTurn = false;
    while (!finishedTurn) {
        console.log('');
        console.log(chalk_1.default.bold.magenta(' AI ') + chalk_1.default.magenta('┃ '));
        try {
            // Use streaming for real-time output
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
            let isFirstContent = true;
            // Process the stream
            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta;
                if (!delta)
                    continue;
                // Handle text content - print it in real-time
                if (delta.content) {
                    if (isFirstContent) {
                        isFirstContent = false;
                    }
                    // Add line prefix for multi-line responses
                    const formatted = delta.content.replace(/\n/g, '\n' + chalk_1.default.magenta('    ┃ '));
                    process.stdout.write(formatted);
                    fullContent += delta.content;
                }
                // Handle tool calls
                if (delta.tool_calls) {
                    for (const toolCallDelta of delta.tool_calls) {
                        const index = toolCallDelta.index;
                        // Initialize new tool call
                        if (index !== currentToolCallIndex) {
                            currentToolCallIndex = index;
                            if (!toolCalls[index]) {
                                toolCalls[index] = {
                                    id: toolCallDelta.id || '',
                                    type: 'function',
                                    function: {
                                        name: '',
                                        arguments: ''
                                    }
                                };
                            }
                        }
                        // Update tool call with delta
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
            // Add a newline after streamed content
            if (fullContent) {
                console.log('');
            }
            // Build the assistant message for history
            const assistantMessage = {
                role: 'assistant',
                content: fullContent || null,
            };
            if (toolCalls.length > 0) {
                assistantMessage.tool_calls = toolCalls;
            }
            history.push(assistantMessage);
            // Process tool calls if any
            if (toolCalls.length > 0) {
                for (const toolCall of toolCalls) {
                    const fnName = toolCall.function.name;
                    let args = {};
                    try {
                        args = JSON.parse(toolCall.function.arguments);
                    }
                    catch (e) {
                        console.log(chalk_1.default.red(`\n  ⚠ Failed to parse tool arguments`));
                        history.push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: 'Error: Failed to parse tool arguments',
                        });
                        continue;
                    }
                    // Stylized tool call display
                    console.log('');
                    console.log(chalk_1.default.yellow('  ┌─ 🔧 TOOL ─────────────────────────────────────────────┐'));
                    console.log(chalk_1.default.yellow('  │ ') + chalk_1.default.bold.white(fnName));
                    // Format args nicely
                    const argsStr = JSON.stringify(args, null, 2);
                    const argsLines = argsStr.split('\n');
                    for (const line of argsLines) {
                        console.log(chalk_1.default.yellow('  │ ') + chalk_1.default.dim(line));
                    }
                    console.log(chalk_1.default.yellow('  └────────────────────────────────────────────────────────┘'));
                    // Permission check for side-effect tools
                    let allowed = true;
                    if (fnName === 'write_file' || fnName === 'run_shell_command') {
                        allowed = await (0, prompts_1.confirm)({
                            message: chalk_1.default.yellow('  Execute this action?'),
                            default: true
                        });
                    }
                    let result = '';
                    if (allowed) {
                        const toolSpinner = (0, ora_1.default)({
                            text: `Executing ${fnName}...`,
                            prefixText: '  ',
                            color: 'yellow'
                        }).start();
                        try {
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
                            toolSpinner.succeed(chalk_1.default.green(`${fnName} completed`));
                            // Show truncated result for visibility
                            const maxLen = 400;
                            const displayResult = result.length > maxLen
                                ? result.substring(0, maxLen) + chalk_1.default.dim(`\n  ... (${result.length - maxLen} more characters)`)
                                : result;
                            if (displayResult.trim()) {
                                console.log(chalk_1.default.dim('  ┌─ Result ─────────────────────────────────────────────┐'));
                                const resultLines = displayResult.split('\n');
                                for (const line of resultLines.slice(0, 15)) {
                                    console.log(chalk_1.default.dim('  │ ') + chalk_1.default.gray(line.substring(0, 55)));
                                }
                                if (resultLines.length > 15) {
                                    console.log(chalk_1.default.dim(`  │ ... (${resultLines.length - 15} more lines)`));
                                }
                                console.log(chalk_1.default.dim('  └────────────────────────────────────────────────────────┘'));
                            }
                        }
                        catch (err) {
                            toolSpinner.fail(chalk_1.default.red(`${fnName} failed`));
                            result = `Error executing tool: ${err.message}`;
                            console.log(chalk_1.default.red(`  Error: ${err.message}`));
                        }
                    }
                    else {
                        console.log(chalk_1.default.yellow('  ⚠ Action cancelled by user'));
                        result = 'Tool execution denied by user.';
                    }
                    history.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: result,
                    });
                }
                // Loop continues to let the model see the tool output and respond
            }
            else {
                finishedTurn = true;
            }
        }
        catch (error) {
            console.log('');
            console.log(chalk_1.default.red('  ┌─ ❌ ERROR ────────────────────────────────────────────┐'));
            console.log(chalk_1.default.red('  │ ') + error.message);
            if (error.message.includes('ECONNREFUSED')) {
                console.log(chalk_1.default.red('  │ ') + chalk_1.default.dim('Make sure LM Studio is running'));
            }
            console.log(chalk_1.default.red('  └────────────────────────────────────────────────────────┘'));
            finishedTurn = true;
        }
    }
}
