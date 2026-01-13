"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolsDefinition = void 0;
exports.listFiles = listFiles;
exports.readFile = readFile;
exports.writeFile = writeFile;
exports.runShellCommand = runShellCommand;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
exports.toolsDefinition = [
    {
        type: 'function',
        function: {
            name: 'list_files',
            description: 'List files in a directory. Use this to discover the project structure.',
            parameters: {
                type: 'object',
                properties: {
                    dir_path: {
                        type: 'string',
                        description: 'The path to the directory to list. Defaults to current directory if not provided.',
                    },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the contents of a file.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: {
                        type: 'string',
                        description: 'The path to the file to read.',
                    },
                },
                required: ['file_path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Write content to a file. This overwrites the file if it exists.',
            parameters: {
                type: 'object',
                properties: {
                    file_path: {
                        type: 'string',
                        description: 'The path to the file to write.',
                    },
                    content: {
                        type: 'string',
                        description: 'The content to write to the file.',
                    },
                },
                required: ['file_path', 'content'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'run_shell_command',
            description: 'Execute a shell command. Use this for git operations, installation, or running scripts. Output is returned.',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'The shell command to execute.',
                    },
                },
                required: ['command'],
            },
        },
    },
];
async function listFiles(dirPath = '.') {
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const formatted = entries
            .map((entry) => {
            const type = entry.isDirectory() ? '[DIR]' : '[FILE]';
            return `${type} ${entry.name}`;
        })
            .join('\n');
        return formatted || '(Empty directory)';
    }
    catch (error) {
        return `Error listing files: ${error.message}`;
    }
}
async function readFile(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return content;
    }
    catch (error) {
        return `Error reading file: ${error.message}`;
    }
}
async function writeFile(filePath, content) {
    try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, 'utf-8');
        return `Successfully wrote to ${filePath}`;
    }
    catch (error) {
        return `Error writing file: ${error.message}`;
    }
}
async function runShellCommand(command) {
    try {
        const { stdout, stderr } = await execAsync(command);
        let output = '';
        if (stdout)
            output += `STDOUT:\n${stdout}\n`;
        if (stderr)
            output += `STDERR:\n${stderr}\n`;
        return output || '(Command completed with no output)';
    }
    catch (error) {
        return `Error executing command: ${error.message}\nSTDERR:\n${error.stderr || ''}`;
    }
}
