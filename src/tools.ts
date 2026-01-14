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

// Security: Validate path to prevent directory traversal
function validatePath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  const cwd = process.cwd();
  
  // Allow paths within cwd or absolute paths that exist
  if (resolved.startsWith(cwd) || path.isAbsolute(inputPath)) {
    return resolved;
  }
  
  throw new Error(`Invalid path: "${inputPath}" - must be within current directory or absolute`);
}

export async function listFiles(dirPath: string = '.'): Promise<string> {
  try {
    const safePath = validatePath(dirPath);
    const entries = await fs.readdir(safePath, { withFileTypes: true });
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
    const safePath = validatePath(filePath);
    const content = await fs.readFile(safePath, 'utf-8');
    return content;
  } catch (error: any) {
    return `Error reading file: ${error.message}`;
  }
}

export async function writeFile(filePath: string, content: string): Promise<string> {
  try {
    const safePath = validatePath(filePath);
    await fs.mkdir(path.dirname(safePath), { recursive: true });
    await fs.writeFile(safePath, content, 'utf-8');
    return `Successfully wrote to ${safePath}`;
  } catch (error: any) {
    return `Error writing file: ${error.message}`;
  }
}

// Timeout wrapper for shell commands
function execWithTimeout(command: string, timeoutMs: number = 30000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = exec(command, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject({ ...error, stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });

    // Ensure child process is killed on timeout
    setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);
  });
}

export async function runShellCommand(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execWithTimeout(command, 30000);
    let output = '';
    if (stdout) output += `STDOUT:\n${stdout}\n`;
    if (stderr) output += `STDERR:\n${stderr}\n`;
    return output || '(Command completed with no output)';
  } catch (error: any) {
    if (error.killed) {
      return `Error: Command timed out after 30 seconds`;
    }
    return `Error executing command: ${error.message}\nSTDERR:\n${error.stderr || ''}`;
  }
}
