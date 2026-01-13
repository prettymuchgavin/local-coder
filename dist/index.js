#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const config_1 = require("./config");
const agent_1 = require("./agent");
const server_1 = require("./server");
const chalk_1 = __importDefault(require("chalk"));
const program = new commander_1.Command();
program
    .name('local-coder')
    .description('A CLI AI coding assistant using local LLMs')
    .version('1.0.0')
    .option('-g, --gui', 'Start the web-based GUI instead of CLI')
    .option('-p, --port <number>', 'Port for the web GUI (default: 3000)', '3000');
program.action(async (options) => {
    try {
        const config = await (0, config_1.loadConfig)();
        if (options.gui) {
            // Start web server
            process.env.PORT = options.port;
            await (0, server_1.startWebServer)(config);
        }
        else {
            // Run CLI agent
            await (0, agent_1.runAgent)(config);
        }
    }
    catch (error) {
        console.error(chalk_1.default.red(`Fatal Error: ${error.message}`));
        process.exit(1);
    }
});
program.parse(process.argv);
