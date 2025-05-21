# Cursor MDC Rules Sync

A VSCode extension to sync MDC rule files from a GitHub repository to your local `.cursor/rules` folder.

## Features

- Connect to a GitHub repository (default: `YOUR-ORG/global-cursor-rules` - define this in `package.json`)
- List and select MDC files (*.mdc) from the repository with their descriptions
- Copy selected files to your local `.cursor/rules` folder
- Compare differences when files already exist
- Options to overwrite, keep current, or manually merge changes
- Support for GitHub authentication via tokens (for private repositories)
- Automatic detection of GitHub tokens from environment variables
- Token preference saving (remembers your choice of token source)
- Token management directly from the file selection interface
- Token validation to ensure tokens work before saving
- Smart detection of tokens in environment variables

## Usage

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type "Sync Cursor MDC Rules" and select the command
3. Select one or more MDC files from the list (descriptions are shown to help you choose)
4. If a file already exists, you'll see a diff view and options to:
   - Overwrite the existing file
   - Keep the current file
   - Merge changes manually

## GitHub Authentication

For private repositories, you'll need to authenticate with GitHub. The extension supports several methods:

1. **Environment Variables**: The extension will automatically detect GitHub tokens from:
   - Any environment variable with a value starting with `ghp_` (GitHub Personal Access Token format)
   - Standard environment variables: `GITHUB_TOKEN`, `GITHUB_PERSONAL_ACCESS_TOKEN`, `GH_TOKEN`

2. **Manual Entry**: You can enter a token manually when prompted

3. **Saved Token**: The extension can save your token securely for future use

### Token Validation

All tokens are validated against the target repository before being used:

- When selecting from environment variables, only valid tokens are offered
- When entering a token manually, it's validated before saving
- If a saved token becomes invalid, you'll be prompted to enter a new one

### Token Preferences

The extension remembers your token preferences:

- If you choose a specific environment variable, it will use that variable in the future
- If you enter a token manually and save it, it will use that token in the future
- If you choose not to use a token, it will remember that preference

### Changing Your Token

You can change your token in two ways:

1. **During File Selection**: The file selection list includes a "Change GitHub Token" option at the top
2. **Command Palette**: Use the "Clear GitHub Token for MDC Rules Sync" command

If your token becomes invalid (e.g., it expires or is revoked), the extension will automatically detect this and prompt you to enter a new token.

## Extension Settings

This extension contributes the following settings:

* `vscode-mdc-rules-sync.repositoryUrl`: GitHub repository to fetch MDC rules from (default: `YOUR-ORG/global-cursor-rules`)

## Development

### Prerequisites

- Node.js
- npm or yarn

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/vscode-mdc-rules-sync.git
cd vscode-mdc-rules-sync

# Install dependencies
npm install

# Install type declarations (if you get type errors)
npm install --save-dev @types/node

# Compile
npm run compile

# Package
npm run package
```

### Running Tests

The extension includes tests to verify its functionality. To run the tests:

```bash
# Compile the tests
npm run compile-tests

# Run the tests
npm run test
```

Or you can use the install script which will also run the tests:

```bash
./install.sh
```

### Troubleshooting Type Errors

If you encounter type errors during development, you may need to install additional type declarations:

```bash
npm install --save-dev @types/node
```

The extension already includes `skipLibCheck: true` in the tsconfig.json to help with some type issues.

### Testing the Extension

Press `F5` in VSCode to launch a new window with the extension loaded.

## License

MIT 