import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const toolsDefinition = [
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

export async function listFiles(dirPath: string = '.'): Promise<string> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const formatted = entries
      .map((entry) => {
        const type = entry.isDirectory() ? '[DIR]' : '[FILE]';
        return `${type} ${entry.name}`;
      })
      .join('\n');
    return formatted || '(Empty directory)';
  } catch (error: any) {
    return `Error listing files: ${error.message}`;
  }
}

export async function readFile(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content;
  } catch (error: any) {
    return `Error reading file: ${error.message}`;
  }
}

export async function writeFile(filePath: string, content: string): Promise<string> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    return `Successfully wrote to ${filePath}`;
  } catch (error: any) {
    return `Error writing file: ${error.message}`;
  }
}

export async function runShellCommand(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command);
    let output = '';
    if (stdout) output += `STDOUT:\n${stdout}\n`;
    if (stderr) output += `STDERR:\n${stderr}\n`;
    return output || '(Command completed with no output)';
  } catch (error: any) {
    return `Error executing command: ${error.message}\nSTDERR:\n${error.stderr || ''}`;
  }
}
