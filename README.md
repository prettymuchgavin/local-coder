# Local Coder

**Your AI-powered local coding assistant** — A CLI and web-based tool that connects to local LLMs (via LM Studio) to help you write code, manage files, and run commands.

![CLI Screenshot](https://img.shields.io/badge/Interface-CLI%20%2B%20GUI-blue) ![Node.js](https://img.shields.io/badge/Node.js-18%2B-green) ![LM Studio](https://img.shields.io/badge/Backend-LM%20Studio-purple)

## ✨ Features

- **🖥️ Dual Interface** — Use the interactive CLI or sleek web-based GUI
- **🤖 Local LLM Support** — Works with any model running in LM Studio
- **📁 File Operations** — Read, write, and list files in your project
- **⚡ Shell Commands** — Execute shell commands with user confirmation
- **🔄 Real-time Streaming** — See AI responses as they're generated
- **🛡️ Safe by Default** — Prompts for approval before file writes or shell commands

## 📋 Prerequisites

1. **Node.js 18+** — [Download here](https://nodejs.org/)
2. **LM Studio** — [Download here](https://lmstudio.ai/)
   - Install LM Studio
   - Download a model (e.g., Llama, Mistral, DeepSeek)
   - Start the local server (default: `http://localhost:1234`)

## 🚀 Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/local-coder.git
cd local-coder

# Install dependencies
npm install

# Build the project
npm run build

# (Optional but Recommended) Install globally for use anywhere
npm link
```

## 📖 Usage

### CLI Mode (Default)

Run the interactive command-line interface:

```bash
# Using npm
npm run cli

# Or if globally installed
local-coder
```

**CLI Commands:**
- Type your coding request and press Enter
- Type `exit` or `quit` to end the session

### GUI Mode

Launch the web-based graphical interface:

```bash
# Using npm
npm run gui

# Or with a custom port
local-coder --gui --port 8080

# Or if globally installed
local-coder -g
```

Then open your browser to `http://localhost:3000` (or your custom port).

## ⚙️ Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
# Custom LM Studio endpoint (default: http://localhost:1234/v1)
LOCAL_LLM_BASE_URL=http://localhost:1234/v1

# Specify a model name (skips interactive selection)
LOCAL_LLM_MODEL=your-model-name

# API Key for cloud providers (optional)
OPENAI_API_KEY=sk-...
# Or use a custom key name
LOCAL_LLM_API_KEY=your-api-key
```

### API Key Support

Local Coder supports connecting to cloud AI providers in addition to local LM Studio:

**Via Environment Variables:**
```bash
# OpenAI
export OPENAI_API_KEY=sk-...
export LOCAL_LLM_BASE_URL=https://api.openai.com/v1

# Any OpenAI-compatible provider
export LOCAL_LLM_API_KEY=your-key
export LOCAL_LLM_BASE_URL=https://api.yourprovider.com/v1
```

**Via Web GUI:**
1. Click the ⚙️ gear icon in the header
2. Enter your API key and base URL
3. Click "Save"

**Common Base URLs:**
| Provider | Base URL |
|----------|----------|
| LM Studio (local) | `http://localhost:1234/v1` |
| OpenAI | `https://api.openai.com/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |

### Config File

Local Coder also saves your settings to `.local-coder-config.json` in your working directory.

## 🛠️ Available Tools

The AI assistant has access to these tools:

| Tool | Description |
|------|-------------|
| `list_files` | List files and directories in a path |
| `read_file` | Read the contents of a file |
| `write_file` | Write content to a file (creates directories if needed) |
| `run_shell_command` | Execute shell commands |

> **Note:** `write_file` and `run_shell_command` require your approval before executing.

## 💡 Example Prompts

```
Create a simple Express.js server with a health check endpoint

Read the package.json and explain what this project does

Add a new utility function to helpers.js that formats dates

Run npm install and show me any errors

Create a new React component called UserCard with TypeScript
```

## 🏗️ Project Structure

```
local-coder/
├── src/
│   ├── index.ts      # Entry point and CLI setup
│   ├── agent.ts      # Main agent loop and conversation handling
│   ├── config.ts     # Configuration and model selection
│   ├── server.ts     # Express server for GUI mode
│   └── tools.ts      # Tool definitions and implementations
├── public/
│   └── index.html    # Web GUI interface
├── dist/             # Compiled JavaScript output
├── package.json
└── tsconfig.json
```

## 🔧 Development

```bash
# Build the project
npm run build

# Run in CLI mode
npm run cli

# Run in GUI mode
npm run gui
```

## 📝 License

ISC License

---

**Made with ❤️ for developers who prefer to keep their AI local**
