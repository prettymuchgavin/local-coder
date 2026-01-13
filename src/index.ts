#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig } from './config';
import { runAgent } from './agent';
import { startWebServer } from './server';
import chalk from 'chalk';

const program = new Command();

program
  .name('local-coder')
  .description('A CLI AI coding assistant using local LLMs')
  .version('1.0.0')
  .option('-g, --gui', 'Start the web-based GUI instead of CLI')
  .option('-p, --port <number>', 'Port for the web GUI (default: 3000)', '3000');

program.action(async (options) => {
  try {
    const config = await loadConfig();

    if (options.gui) {
      // Start web server
      process.env.PORT = options.port;
      await startWebServer(config);
    } else {
      // Run CLI agent
      await runAgent(config);
    }
  } catch (error: any) {
    console.error(chalk.red(`Fatal Error: ${error.message}`));
    process.exit(1);
  }
});

program.parse(process.argv);
