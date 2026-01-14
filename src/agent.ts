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

const SINGLE_MODEL_SYSTEM_PROMPT = `You are a skilled software engineer helping with coding tasks. You have access to tools for reading/writing files and running shell commands.

CRITICAL COMMUNICATION RULES:
- ALWAYS explain what you're about to do BEFORE using any tool. Never use tools silently.
- While working, narrate your thought process: "I'll create the file structure first...", "Now let me add the main logic...", "Let me check if that worked..."
- After completing a task, briefly summarize what you did.

BEHAVIOR RULES:
- Do NOT introduce yourself. Just start helping.
- Be conversational but concise - like a coworker explaining as they code.
- When writing code, explain key parts: "This function handles...", "I'm using X because..."
- If something fails, explain what went wrong and how you'll fix it.
- When creating a NEW PROJECT, ALWAYS create a dedicated folder first (use kebab-case naming).`;

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

  // Display stylized banner
  console.log(BANNER);

  // Connection info
  console.log(chalk.green('  ✓ ') + chalk.white('Connected to LM Studio'));
  console.log(chalk.dim(`    Endpoint: ${config.baseURL}`));

  if (config.dualMode) {
    console.log(chalk.magenta(`    ✨ Enhancer: ${config.thinkingModel}`));
    console.log(chalk.cyan(`    ⚡ Executor: ${config.executingModel}`));
  } else {
    console.log(chalk.dim(`    Model:    ${config.model}`));
  }
  console.log('');

  printDivider();
  console.log(chalk.dim('  Commands: ') + chalk.yellow('exit') + chalk.dim(' or ') + chalk.yellow('quit') + chalk.dim(' to end session'));
  if (config.dualMode) {
    console.log(chalk.dim('  Mode: ') + chalk.magenta('Dual-Model') + chalk.dim(' (enhancer + executor)'));
  }
  console.log(chalk.dim('  Tip: Ask me to create projects, write code, or debug issues!'));
  printDivider();
  console.log('');

  // Initialize history based on mode
  const history: ChatMessage[] = [];

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

    if (config.dualMode) {
      await processDualModelTurn(client, config, userMessage);
    } else {
      history.push({ role: 'system', content: SINGLE_MODEL_SYSTEM_PROMPT });
      history.push({ role: 'user', content: userMessage });
      await processSingleModelTurn(client, config, history);
      // Clear system prompt for next turn
      history.shift();
    }
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

// Dual-model processing
async function processDualModelTurn(client: OpenAI, config: Config, userMessage: string) {
  // Phase 1: Enhancing the prompt
  console.log('');
  console.log(chalk.magenta.bold('  ┌─ ✨ ENHANCING PROMPT ──────────────────────────────────────┐'));

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
    const enhancerSpinner = ora({
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

    console.log(chalk.magenta('  │'));
    for (const line of preview) {
      console.log(chalk.magenta('  │ ') + chalk.dim(line.substring(0, 58)));
    }
    if (lines.length > 8) {
      console.log(chalk.magenta('  │ ') + chalk.dim(`... (${lines.length - 8} more lines)`));
    }
    console.log(chalk.magenta('  │'));

    console.log(chalk.magenta('  └────────────────────────────────────────────────────────────┘'));

    showFullEnhanced = await confirm({
      message: chalk.dim('  Show full enhanced prompt?'),
      default: false
    });

    if (showFullEnhanced) {
      console.log('');
      console.log(chalk.dim('  ┌─ Enhanced Prompt ───────────────────────────────────────────┐'));
      for (const line of enhancedPrompt.split('\n')) {
        console.log(chalk.dim('  │ ') + line.substring(0, 58));
      }
      console.log(chalk.dim('  └────────────────────────────────────────────────────────────┘'));
    }

  } catch (error: any) {
    console.log(chalk.magenta('  │ ') + chalk.red(`Error: ${error.message}`));
    console.log(chalk.magenta('  └────────────────────────────────────────────────────────────┘'));
    return;
  }

  // Ask to proceed with execution
  const proceed = await confirm({
    message: chalk.cyan('  Execute with enhanced prompt?'),
    default: true
  });

  if (!proceed) {
    console.log(chalk.yellow('  Cancelled.'));
    return;
  }

  // Phase 2: Executing
  console.log('');
  console.log(chalk.cyan.bold('  ┌─ ⚡ EXECUTING ────────────────────────────────────────────┐'));
  console.log(chalk.cyan('  │'));

  const executingHistory: ChatMessage[] = [
    { role: 'system', content: EXECUTING_SYSTEM_PROMPT },
    { role: 'user', content: enhancedPrompt }
  ];


  await processExecutingPhase(client, config, executingHistory);

  console.log(chalk.cyan('  │'));
  console.log(chalk.cyan('  └────────────────────────────────────────────────────────────┘'));
}

// Single model processing (existing logic)
async function processSingleModelTurn(client: OpenAI, config: Config, history: ChatMessage[]) {
  let finishedTurn = false;

  while (!finishedTurn) {
    console.log('');
    console.log(chalk.bold.magenta(' AI ') + chalk.magenta('┃ '));

    try {
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

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          const formatted = delta.content.replace(/\n/g, '\n' + chalk.magenta('    ┃ '));
          process.stdout.write(formatted);
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
            if (toolCallDelta.id) toolCalls[index].id = toolCallDelta.id;
            if (toolCallDelta.function?.name) toolCalls[index].function.name += toolCallDelta.function.name;
            if (toolCallDelta.function?.arguments) toolCalls[index].function.arguments += toolCallDelta.function.arguments;
          }
        }
      }

      if (fullContent) console.log('');

      const assistantMessage: any = { role: 'assistant', content: fullContent || null };
      if (toolCalls.length > 0) assistantMessage.tool_calls = toolCalls;
      history.push(assistantMessage);

      if (toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          await executeToolCall(toolCall, history);
        }
      } else {
        finishedTurn = true;
      }

    } catch (error: any) {
      console.log(chalk.red(`\n  ❌ Error: ${error.message}`));
      finishedTurn = true;
    }
  }
}

// Executing phase for dual-model
async function processExecutingPhase(client: OpenAI, config: Config, history: ChatMessage[]) {
  let finishedTurn = false;

  while (!finishedTurn) {
    try {
      const stream = await client.chat.completions.create({
        model: config.executingModel,
        messages: history,
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
          const formatted = delta.content.replace(/\n/g, '\n' + chalk.cyan('  │ '));
          process.stdout.write(chalk.cyan('  │ ') + formatted);
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
            if (toolCallDelta.id) toolCalls[index].id = toolCallDelta.id;
            if (toolCallDelta.function?.name) toolCalls[index].function.name += toolCallDelta.function.name;
            if (toolCallDelta.function?.arguments) toolCalls[index].function.arguments += toolCallDelta.function.arguments;
          }
        }
      }

      if (fullContent) console.log('');

      const assistantMessage: any = { role: 'assistant', content: fullContent || null };
      if (toolCalls.length > 0) assistantMessage.tool_calls = toolCalls;
      history.push(assistantMessage);

      if (toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          await executeToolCall(toolCall, history, '  ');
        }
      } else {
        finishedTurn = true;
      }

    } catch (error: any) {
      console.log(chalk.red(`\n  │ ❌ Error: ${error.message}`));
      finishedTurn = true;
    }
  }
}

// Shared tool execution
async function executeToolCall(toolCall: StreamedToolCall, history: ChatMessage[], indent: string = '') {
  const fnName = toolCall.function.name;
  let args: any = {};

  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch (e) {
    console.log(chalk.red(`${indent}⚠ Failed to parse tool arguments`));
    history.push({ role: 'tool', tool_call_id: toolCall.id, content: 'Error: Failed to parse tool arguments' });
    return;
  }

  console.log('');
  console.log(chalk.yellow(`${indent}┌─ 🔧 ${fnName} ─────────────────────────────────────────┐`));
  const argsStr = JSON.stringify(args, null, 2);
  for (const line of argsStr.split('\n').slice(0, 5)) {
    console.log(chalk.yellow(`${indent}│ `) + chalk.dim(line));
  }
  console.log(chalk.yellow(`${indent}└────────────────────────────────────────────────────────┘`));

  let allowed = true;
  if (fnName === 'write_file' || fnName === 'run_shell_command') {
    allowed = await confirm({ message: chalk.yellow(`${indent}Execute?`), default: true });
  }

  let result = '';
  if (allowed) {
    const spinner = ora({ text: `Executing ${fnName}...`, prefixText: indent, color: 'yellow' }).start();
    try {
      if (fnName === 'list_files') result = await listFiles(args.dir_path);
      else if (fnName === 'read_file') result = await readFile(args.file_path);
      else if (fnName === 'write_file') result = await writeFile(args.file_path, args.content);
      else if (fnName === 'run_shell_command') result = await runShellCommand(args.command);
      else result = 'Error: Unknown tool';
      spinner.succeed(chalk.green(`${fnName} ✓`));
    } catch (err: any) {
      spinner.fail(chalk.red(`${fnName} failed`));
      result = `Error: ${err.message}`;
    }
  } else {
    result = 'Tool execution denied by user.';
    console.log(chalk.yellow(`${indent}Cancelled`));
  }

  history.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
}
