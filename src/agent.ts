import { OpenAI } from 'openai';
import { input, confirm } from '@inquirer/prompts';
import ora from 'ora';
import chalk from 'chalk';
import { toolsDefinition, listFiles, readFile, writeFile, runShellCommand } from './tools';
import { Config, createClient } from './config';

// Define types compatible with OpenAI SDK
type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// Stylized ASCII banner
const BANNER = `
${chalk.cyan('╔═══════════════════════════════════════════════════════════════╗')}
${chalk.cyan('║')}  ${chalk.bold.white('██╗      ██████╗  ██████╗ █████╗ ██╗')}      ${chalk.bold.magenta('██████╗ ██████╗')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white('██║     ██╔═══██╗██╔════╝██╔══██╗██║')}     ${chalk.bold.magenta('██╔════╝██╔═══██╗')} ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white('██║     ██║   ██║██║     ███████║██║')}     ${chalk.bold.magenta('██║     ██║   ██║')} ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white('██║     ██║   ██║██║     ██╔══██║██║')}     ${chalk.bold.magenta('██║     ██║   ██║')} ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white('███████╗╚██████╔╝╚██████╗██║  ██║███████╗')} ${chalk.bold.magenta('╚██████╗╚██████╔╝')} ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.bold.white('╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝')}  ${chalk.bold.magenta('╚═════╝ ╚═════╝')} ${chalk.cyan('║')}
${chalk.cyan('╠═══════════════════════════════════════════════════════════════╣')}
${chalk.cyan('║')}  ${chalk.dim('Your AI-powered local coding assistant')}                        ${chalk.cyan('║')}
${chalk.cyan('╚═══════════════════════════════════════════════════════════════╝')}
`;

function printDivider() {
  console.log(chalk.dim('─'.repeat(65)));
}

function printBox(title: string, content: string, color: typeof chalk.cyan = chalk.cyan) {
  const lines = content.split('\n');
  const maxLen = Math.max(title.length, ...lines.map(l => l.length));
  const width = Math.min(maxLen + 4, 63);

  console.log(color(`┌─ ${title} ${'─'.repeat(Math.max(0, width - title.length - 4))}┐`));
  for (const line of lines) {
    console.log(color('│ ') + line.padEnd(width - 2) + color(' │'));
  }
  console.log(color('└' + '─'.repeat(width) + '┘'));
}

export async function runAgent(config: Config) {
  const client = createClient(config);
  const history: ChatMessage[] = [
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
  console.log(chalk.green('  ✓ ') + chalk.white('Connected to LM Studio'));
  console.log(chalk.dim(`    Endpoint: ${config.baseURL}`));
  console.log(chalk.dim(`    Model:    ${config.model}`));
  console.log('');

  printDivider();
  console.log(chalk.dim('  Commands: ') + chalk.yellow('exit') + chalk.dim(' or ') + chalk.yellow('quit') + chalk.dim(' to end session'));
  console.log(chalk.dim('  Tip: Ask me to create projects, write code, or debug issues!'));
  printDivider();
  console.log('');

  while (true) {
    const userMessage = await input({
      message: chalk.green('❯'),
      theme: {
        prefix: chalk.bold.cyan(' YOU '),
      }
    });

    if (userMessage.toLowerCase() === 'exit' || userMessage.toLowerCase() === 'quit') {
      console.log('');
      printDivider();
      console.log(chalk.yellow('  👋 Goodbye! Happy coding!'));
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

interface StreamedToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

async function processTurn(client: OpenAI, config: Config, history: ChatMessage[]) {
  let finishedTurn = false;

  while (!finishedTurn) {
    console.log('');
    console.log(chalk.bold.magenta(' AI ') + chalk.magenta('┃ '));

    try {
      // Use streaming for real-time output
      const stream = await client.chat.completions.create({
        model: config.model,
        messages: history,
        tools: toolsDefinition as any,
        tool_choice: 'auto',
        stream: true,
      });

      let fullContent = '';
      let toolCalls: StreamedToolCall[] = [];
      let currentToolCallIndex = -1;
      let isFirstContent = true;

      // Process the stream
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        if (!delta) continue;

        // Handle text content - print it in real-time
        if (delta.content) {
          if (isFirstContent) {
            isFirstContent = false;
          }
          // Add line prefix for multi-line responses
          const formatted = delta.content.replace(/\n/g, '\n' + chalk.magenta('    ┃ '));
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
      const assistantMessage: any = {
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
          let args: any = {};

          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch (e) {
            console.log(chalk.red(`\n  ⚠ Failed to parse tool arguments`));
            history.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: 'Error: Failed to parse tool arguments',
            });
            continue;
          }

          // Stylized tool call display
          console.log('');
          console.log(chalk.yellow('  ┌─ 🔧 TOOL ─────────────────────────────────────────────┐'));
          console.log(chalk.yellow('  │ ') + chalk.bold.white(fnName));

          // Format args nicely
          const argsStr = JSON.stringify(args, null, 2);
          const argsLines = argsStr.split('\n');
          for (const line of argsLines) {
            console.log(chalk.yellow('  │ ') + chalk.dim(line));
          }
          console.log(chalk.yellow('  └────────────────────────────────────────────────────────┘'));

          // Permission check for side-effect tools
          let allowed = true;
          if (fnName === 'write_file' || fnName === 'run_shell_command') {
            allowed = await confirm({
              message: chalk.yellow('  Execute this action?'),
              default: true
            });
          }

          let result = '';
          if (allowed) {
            const toolSpinner = ora({
              text: `Executing ${fnName}...`,
              prefixText: '  ',
              color: 'yellow'
            }).start();

            try {
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
              toolSpinner.succeed(chalk.green(`${fnName} completed`));

              // Show truncated result for visibility
              const maxLen = 400;
              const displayResult = result.length > maxLen
                ? result.substring(0, maxLen) + chalk.dim(`\n  ... (${result.length - maxLen} more characters)`)
                : result;

              if (displayResult.trim()) {
                console.log(chalk.dim('  ┌─ Result ─────────────────────────────────────────────┐'));
                const resultLines = displayResult.split('\n');
                for (const line of resultLines.slice(0, 15)) {
                  console.log(chalk.dim('  │ ') + chalk.gray(line.substring(0, 55)));
                }
                if (resultLines.length > 15) {
                  console.log(chalk.dim(`  │ ... (${resultLines.length - 15} more lines)`));
                }
                console.log(chalk.dim('  └────────────────────────────────────────────────────────┘'));
              }

            } catch (err: any) {
              toolSpinner.fail(chalk.red(`${fnName} failed`));
              result = `Error executing tool: ${err.message}`;
              console.log(chalk.red(`  Error: ${err.message}`));
            }
          } else {
            console.log(chalk.yellow('  ⚠ Action cancelled by user'));
            result = 'Tool execution denied by user.';
          }

          history.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          });
        }
        // Loop continues to let the model see the tool output and respond
      } else {
        finishedTurn = true;
      }

    } catch (error: any) {
      console.log('');
      console.log(chalk.red('  ┌─ ❌ ERROR ────────────────────────────────────────────┐'));
      console.log(chalk.red('  │ ') + error.message);
      if (error.message.includes('ECONNREFUSED')) {
        console.log(chalk.red('  │ ') + chalk.dim('Make sure LM Studio is running'));
      }
      console.log(chalk.red('  └────────────────────────────────────────────────────────┘'));
      finishedTurn = true;
    }
  }
}
