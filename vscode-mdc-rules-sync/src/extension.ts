import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { Octokit } from '@octokit/rest';
import * as os from 'os';

// Interface for MDC file metadata
interface MdcFileInfo {
  name: string;
  description: string;
  downloadUrl: string;
}

// Interface for quick pick item with file info
interface MdcQuickPickItem extends vscode.QuickPickItem {
  file: MdcFileInfo;
}

// Special quick pick item for token management
interface TokenManagementQuickPickItem extends vscode.QuickPickItem {
  id: string;
}

// Token source enum
enum TokenSource {
  None = 'none',
  Saved = 'saved',
  Environment = 'environment',
  Manual = 'manual'
}

// Token selection options
enum TokenSelectionOption {
  FromEnvironment = 'from_environment',
  EnterManually = 'enter_manually',
  NoToken = 'no_token'
}

// Create output channel for logging
let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
  // Initialize output channel
  outputChannel = vscode.window.createOutputChannel('Cursor MDC Rules Sync');
  context.subscriptions.push(outputChannel);
  
  // Show output channel immediately
  outputChannel.show(true);
  outputChannel.appendLine('Cursor MDC Rules Sync extension is now active');
  console.log('Cursor MDC Rules Sync extension is now active');

  const syncRulesCommand = vscode.commands.registerCommand('vscode-mdc-rules-sync.syncRules', async () => {
    try {
      // Force show output channel
      outputChannel.clear();
      outputChannel.show(true);
      outputChannel.appendLine('Starting MDC rules sync...');
      
      // Get repository from configuration
      const config = vscode.workspace.getConfiguration('vscode-mdc-rules-sync');
      const repoPath = config.get<string>('repositoryUrl') || 'YOUR-ORG/global-cursor-rules';
      outputChannel.appendLine(`Using repository: ${repoPath}`);
      
      const [owner, repo] = repoPath.split('/');
      if (!owner || !repo) {
        const errorMsg = `Invalid repository path: ${repoPath}. Format should be 'owner/repo'`;
        outputChannel.appendLine(errorMsg);
        vscode.window.showErrorMessage(errorMsg);
        return;
      }

      // Check for GitHub token
      let token = await getGitHubToken(context, owner, repo);
      if (token === null) {
        // User cancelled token selection
        return;
      }
      
      let tokenSource = await context.globalState.get<TokenSource>('tokenSource') || TokenSource.None;
      
      // Create Octokit instance with or without token
      let octokit: Octokit;
      if (token) {
        outputChannel.appendLine('Using GitHub token for authentication');
        octokit = new Octokit({ auth: token });
      } else {
        outputChannel.appendLine('Connecting to GitHub API without authentication (public repos only)');
        octokit = new Octokit();
      }
      
      // Get repository contents
      try {
        outputChannel.appendLine(`Fetching contents from ${owner}/${repo}...`);
        
        // Log the request details
        outputChannel.appendLine(`Request details: GET /repos/${owner}/${repo}/contents`);
        
        const response = await octokit.repos.getContent({
          owner,
          repo,
          path: ''
        });

        outputChannel.appendLine(`Response status: ${response.status}`);
        outputChannel.appendLine('Successfully fetched repository contents');
        
        if (!Array.isArray(response.data)) {
          const errorMsg = 'Failed to fetch repository contents: Response data is not an array';
          outputChannel.appendLine(errorMsg);
          outputChannel.appendLine(`Response data type: ${typeof response.data}`);
          outputChannel.appendLine(`Response data: ${JSON.stringify(response.data, null, 2)}`);
          vscode.window.showErrorMessage(errorMsg);
          return;
        }

        // Filter for MDC files
        const mdcFiles = response.data.filter((file: any) => 
          file.type === 'file' && 
          file.name.endsWith('.mdc')
        );

        outputChannel.appendLine(`Found ${mdcFiles.length} MDC files in the repository`);
        outputChannel.appendLine(`File names: ${mdcFiles.map((f: any) => f.name).join(', ')}`);

        if (mdcFiles.length === 0) {
          const infoMsg = 'No MDC files found in the repository';
          outputChannel.appendLine(infoMsg);
          vscode.window.showInformationMessage(infoMsg);
          return;
        }

        // Show loading indicator
        vscode.window.withProgress<MdcFileInfo[]>({
          location: vscode.ProgressLocation.Notification,
          title: "Loading MDC files...",
          cancellable: false
        }, async (progress) => {
          progress.report({ increment: 0 });
          
          // Fetch content of each MDC file to extract description
          const mdcFilesWithDescription: MdcFileInfo[] = [];
          let processedFiles = 0;
          
          for (const file of mdcFiles) {
            if (file.download_url) {
              try {
                outputChannel.appendLine(`Downloading ${file.name}`);
                // Use non-null assertion since we've already checked file.download_url is defined
                const content = await downloadFile(file.download_url, token || undefined);
                if (content) {
                  const description = extractDescription(content);
                  outputChannel.appendLine(`Extracted description for ${file.name}: ${description || 'No description found'}`);
                  
                  mdcFilesWithDescription.push({
                    name: file.name,
                    description: description || 'No description available',
                    downloadUrl: file.download_url
                  });
                }
              } catch (error) {
                const errorMsg = `Error fetching ${file.name}: ${error instanceof Error ? error.message : String(error)}`;
                outputChannel.appendLine(errorMsg);
                console.error(errorMsg, error);
              }
              
              processedFiles++;
              progress.report({ increment: (processedFiles / mdcFiles.length) * 100 });
            } else {
              outputChannel.appendLine(`Warning: No download URL for ${file.name}`);
            }
          }
          
          return mdcFilesWithDescription;
        }).then(async (mdcFilesWithDescription) => {
          if (!mdcFilesWithDescription || mdcFilesWithDescription.length === 0) {
            const errorMsg = 'Failed to load MDC files';
            outputChannel.appendLine(errorMsg);
            vscode.window.showErrorMessage(errorMsg);
            return;
          }
          
          outputChannel.appendLine(`Loaded ${mdcFilesWithDescription.length} MDC files with descriptions`);
          
          // Create quick pick items with descriptions
          const quickPickItems: (MdcQuickPickItem | TokenManagementQuickPickItem)[] = mdcFilesWithDescription.map(file => ({
            label: file.name,
            description: file.description,
            detail: `${file.description}`,
            file: file
          }));
          
          // Add token management option at the top
          quickPickItems.unshift({
            id: 'change-token',
            label: '$(key) Change GitHub Token',
            description: token ? 'Currently using a GitHub token' : 'Not using a GitHub token',
            detail: 'Clear current token and choose a different one'
          });
          
          // Show quick pick to select files
          outputChannel.appendLine('Showing file selection dialog...');
          const selectedItems = await vscode.window.showQuickPick<MdcQuickPickItem | TokenManagementQuickPickItem>(
            quickPickItems,
            {
              canPickMany: true,
              placeHolder: 'Select MDC files to sync',
              matchOnDescription: true,
              matchOnDetail: true
            }
          );
          
          if (!selectedItems || selectedItems.length === 0) {
            outputChannel.appendLine('No files selected, operation cancelled');
            return;
          }
          
          // Check if token management option was selected
          const tokenManagementItem = selectedItems.find(item => 'id' in item && item.id === 'change-token') as TokenManagementQuickPickItem | undefined;
          if (tokenManagementItem) {
            outputChannel.appendLine('User chose to change GitHub token');
            
            // Clear token and token source
            await context.globalState.update('githubToken', undefined);
            await context.globalState.update('tokenSource', TokenSource.None);
            await context.globalState.update('preferredEnvToken', undefined);
            
            // Prompt for new token
            const newToken = await selectAndValidateToken(context, owner, repo);
            if (newToken === null) {
              vscode.window.showInformationMessage('Token selection cancelled. Please run the command again if you want to sync MDC rules.');
            } else {
              vscode.window.showInformationMessage('GitHub token has been updated. Please run the command again to sync MDC rules.');
            }
            return;
          }
          
          // Filter out token management item
          const mdcItems = selectedItems.filter(item => 'file' in item) as MdcQuickPickItem[];
          
          if (mdcItems.length === 0) {
            outputChannel.appendLine('No MDC files selected, only token management option');
            return;
          }
          
          outputChannel.appendLine(`Selected ${mdcItems.length} files to sync`);
          
          // Get selected files content
          for (const item of mdcItems) {
            const fileInfo = item.file;
            
            outputChannel.appendLine(`Processing ${fileInfo.name}...`);
            
            // Download file content
            const fileContent = await downloadFile(fileInfo.downloadUrl, token || undefined);
            if (!fileContent) {
              const errorMsg = `Failed to download ${fileInfo.name}`;
              outputChannel.appendLine(errorMsg);
              vscode.window.showErrorMessage(errorMsg);
              continue;
            }
            
            // Ensure .cursor/rules directory exists
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
              const errorMsg = 'No workspace folder is open';
              outputChannel.appendLine(errorMsg);
              vscode.window.showErrorMessage(errorMsg);
              return;
            }
            
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const cursorRulesDir = path.join(workspaceRoot, '.cursor', 'rules');
            
            outputChannel.appendLine(`Target directory: ${cursorRulesDir}`);
            
            if (!fs.existsSync(cursorRulesDir)) {
              outputChannel.appendLine(`Creating directory: ${cursorRulesDir}`);
              fs.mkdirSync(cursorRulesDir, { recursive: true });
            }
            
            const targetFilePath = path.join(cursorRulesDir, fileInfo.name);
            const targetFileUri = vscode.Uri.file(targetFilePath);
            
            // Check if file already exists
            if (fs.existsSync(targetFilePath)) {
              outputChannel.appendLine(`File already exists: ${targetFilePath}`);
              const existingContent = fs.readFileSync(targetFilePath, 'utf8');
              
              // If content is different, show diff
              if (existingContent !== fileContent) {
                outputChannel.appendLine('Content differs, showing diff view...');
                // Create temp file with new content
                const tempFilePath = path.join(workspaceRoot, `.cursor-temp-${fileInfo.name}`);
                const tempFileUri = vscode.Uri.file(tempFilePath);
                
                fs.writeFileSync(tempFilePath, fileContent);
                
                // Show diff editor
                await vscode.commands.executeCommand('vscode.diff', 
                  targetFileUri, 
                  tempFileUri, 
                  `${fileInfo.name} (Current vs New)`
                );
                
                // Ask user what to do
                outputChannel.appendLine('Asking user for action...');
                const action = await vscode.window.showQuickPick(
                  ['Overwrite', 'Keep Current', 'Merge Manually'],
                  { placeHolder: `What would you like to do with ${fileInfo.name}?` }
                );
                
                outputChannel.appendLine(`User selected: ${action || 'No action (cancelled)'}`);
                
                if (action === 'Overwrite') {
                  fs.writeFileSync(targetFilePath, fileContent);
                  const infoMsg = `Overwritten ${fileInfo.name}`;
                  outputChannel.appendLine(infoMsg);
                  vscode.window.showInformationMessage(infoMsg);
                } else if (action === 'Merge Manually') {
                  // Open both files for manual merging
                  await vscode.window.showTextDocument(targetFileUri);
                  outputChannel.appendLine('Opened file for manual merging');
                }
                
                // Clean up temp file
                fs.unlinkSync(tempFilePath);
                outputChannel.appendLine(`Removed temp file: ${tempFilePath}`);
              } else {
                const infoMsg = `${fileInfo.name} is already up to date`;
                outputChannel.appendLine(infoMsg);
                vscode.window.showInformationMessage(infoMsg);
              }
            } else {
              // File doesn't exist, just write it
              outputChannel.appendLine(`Creating new file: ${targetFilePath}`);
              fs.writeFileSync(targetFilePath, fileContent);
              const infoMsg = `Added ${fileInfo.name}`;
              outputChannel.appendLine(infoMsg);
              vscode.window.showInformationMessage(infoMsg);
            }
          }
          
          const completionMsg = 'MDC rules sync completed';
          outputChannel.appendLine(completionMsg);
          vscode.window.showInformationMessage(completionMsg);
        });
      } catch (error: any) {
        const errorMsg = `Error fetching repository contents: ${error instanceof Error ? error.message : String(error)}`;
        outputChannel.appendLine(errorMsg);
        
        // Log detailed error information
        if (error instanceof Error) {
          outputChannel.appendLine(`Error name: ${error.name}`);
          outputChannel.appendLine(`Error message: ${error.message}`);
          outputChannel.appendLine(`Error stack: ${error.stack}`);
        }
        
        outputChannel.appendLine(`Details: ${JSON.stringify(error, null, 2)}`);
        
        // Check if it's a 404 error or authentication error
        const isAuthError = error.status === 401 || error.status === 403 || 
                           (error instanceof Error && (error.message.includes('Unauthorized') || 
                                                      error.message.includes('Forbidden')));
        
        const isNotFoundError = error.status === 404 || 
                               (error instanceof Error && error.message.includes('Not Found'));
        
        if (isAuthError) {
          outputChannel.appendLine('This appears to be an authentication error. Your token may be invalid or expired.');
          // Clear token preference since it's invalid
          await context.globalState.update('tokenSource', TokenSource.None);
          await context.globalState.update('githubToken', undefined);
          await context.globalState.update('preferredEnvToken', undefined);
          
          const tryAgain = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: 'Authentication failed. Would you like to try with a different token?'
          });
          
          if (tryAgain === 'Yes') {
            // Prompt for new token
            const newToken = await selectAndValidateToken(context, owner, repo);
            if (newToken !== null) {
              vscode.window.showInformationMessage('GitHub token has been updated. Please run the command again to sync MDC rules.');
            }
          } else {
            vscode.window.showErrorMessage('Authentication failed. Your GitHub token may be invalid or expired.');
          }
          return;
        } else if (isNotFoundError) {
          outputChannel.appendLine('This appears to be a 404 Not Found error. Possible causes:');
          outputChannel.appendLine('1. The repository does not exist');
          outputChannel.appendLine('2. The repository is private and requires authentication');
          outputChannel.appendLine('3. You do not have access to the repository');
          
          // Offer to reset token if one was used
          if (token) {
            const resetToken = await vscode.window.showQuickPick(['Yes', 'No'], {
              placeHolder: 'Do you want to reset your GitHub token?'
            });
            
            if (resetToken === 'Yes') {
              await context.globalState.update('githubToken', undefined);
              await context.globalState.update('tokenSource', TokenSource.None);
              await context.globalState.update('preferredEnvToken', undefined);
              
              // Prompt for new token
              const newToken = await selectAndValidateToken(context, owner, repo);
              if (newToken !== null) {
                vscode.window.showInformationMessage('GitHub token has been updated. Please run the command again to sync MDC rules.');
              }
              return;
            }
          } else {
            // Offer to add a token if none was used
            const addToken = await vscode.window.showQuickPick(['Yes', 'No'], {
              placeHolder: 'Do you want to add a GitHub token for authentication?'
            });
            
            if (addToken === 'Yes') {
              const newToken = await selectAndValidateToken(context, owner, repo);
              if (newToken !== null) {
                vscode.window.showInformationMessage('GitHub token has been saved. Please run the command again.');
              }
              return;
            }
          }
        }
        
        vscode.window.showErrorMessage(`Error syncing MDC rules: ${error instanceof Error ? error.message : String(error)}`);
      }
    } catch (error) {
      const errorMsg = `Error syncing MDC rules: ${error instanceof Error ? error.message : String(error)}`;
      outputChannel.appendLine(errorMsg);
      console.error('Error syncing MDC rules:', error);
      vscode.window.showErrorMessage(errorMsg);
    }
  });

  // Add command to clear GitHub token
  const clearTokenCommand = vscode.commands.registerCommand('vscode-mdc-rules-sync.clearGitHubToken', async () => {
    await context.globalState.update('githubToken', undefined);
    await context.globalState.update('tokenSource', TokenSource.None);
    await context.globalState.update('preferredEnvToken', undefined);
    outputChannel.appendLine('GitHub token has been cleared');
    vscode.window.showInformationMessage('GitHub token has been cleared');
  });

  context.subscriptions.push(syncRulesCommand);
  context.subscriptions.push(clearTokenCommand);
}

// Function to get GitHub token from various sources
async function getGitHubToken(context: vscode.ExtensionContext, owner: string, repo: string): Promise<string | undefined | null> {
  // Check if we have a saved token source preference
  const tokenSource = await context.globalState.get<TokenSource>('tokenSource');
  
  // If we have a saved token and the source is saved, use it
  if (tokenSource === TokenSource.Saved) {
    const savedToken = context.globalState.get<string>('githubToken');
    if (savedToken) {
      outputChannel.appendLine('Using saved GitHub token from extension storage (user preference)');
      // Validate the token
      if (await validateGitHubToken(savedToken, owner, repo)) {
        return savedToken;
      } else {
        outputChannel.appendLine('Saved token is invalid, prompting for a new one');
        // Token is invalid, clear it
        await context.globalState.update('githubToken', undefined);
        await context.globalState.update('tokenSource', TokenSource.None);
      }
    }
  }
  
  // If we have a preferred environment variable, use it
  if (tokenSource === TokenSource.Environment) {
    const preferredEnvVar = context.globalState.get<string>('preferredEnvToken');
    if (preferredEnvVar && process.env[preferredEnvVar]) {
      outputChannel.appendLine(`Using GitHub token from ${preferredEnvVar} environment variable (user preference)`);
      // Validate the token
      if (await validateGitHubToken(process.env[preferredEnvVar]!, owner, repo)) {
        return process.env[preferredEnvVar];
      } else {
        outputChannel.appendLine(`Token from ${preferredEnvVar} is invalid, prompting for a new one`);
        // Token is invalid, clear preference
        await context.globalState.update('preferredEnvToken', undefined);
        await context.globalState.update('tokenSource', TokenSource.None);
      }
    }
  }
  
  // If we have a preference for no token, respect it
  if (tokenSource === TokenSource.None) {
    outputChannel.appendLine('User previously chose not to use a token');
    return undefined;
  }
  
  // If no preference or preferred source is unavailable, prompt for token selection
  return selectAndValidateToken(context, owner, repo);
}

// Function to select and validate a token
async function selectAndValidateToken(context: vscode.ExtensionContext, owner: string, repo: string): Promise<string | undefined | null> {
  // Show token selection options
  const options = [
    { label: 'From GitHub Environment Variables', id: TokenSelectionOption.FromEnvironment, description: 'Automatically detect tokens in environment variables' },
    { label: 'Enter Manually', id: TokenSelectionOption.EnterManually, description: 'Enter a GitHub personal access token' },
    { label: 'Continue without a token', id: TokenSelectionOption.NoToken, description: 'Only works with public repositories' }
  ];
  
  const selection = await vscode.window.showQuickPick(options, {
    placeHolder: 'How would you like to authenticate with GitHub?'
  });
  
  if (!selection) {
    outputChannel.appendLine('Token selection cancelled');
    return null; // User cancelled
  }
  
  switch (selection.id) {
    case TokenSelectionOption.FromEnvironment:
      return await selectFromEnvironment(context, owner, repo);
    case TokenSelectionOption.EnterManually:
      return await enterTokenManually(context, owner, repo);
    case TokenSelectionOption.NoToken:
      outputChannel.appendLine('User chose not to use a token');
      await context.globalState.update('tokenSource', TokenSource.None);
      return undefined;
    default:
      return undefined;
  }
}

// Function to select a token from environment variables
async function selectFromEnvironment(context: vscode.ExtensionContext, owner: string, repo: string): Promise<string | undefined | null> {
  outputChannel.appendLine('Searching for GitHub tokens in environment variables...');
  
  // Find all environment variables with values starting with 'ghp_'
  const envVarsWithTokens: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value && value.startsWith('ghp_')) {
      envVarsWithTokens[key] = value;
    }
  }
  
  // Also check standard GitHub token environment variables
  const standardEnvVars = ['GITHUB_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'GH_TOKEN'];
  for (const key of standardEnvVars) {
    if (process.env[key] && !envVarsWithTokens[key]) {
      envVarsWithTokens[key] = process.env[key]!;
    }
  }
  
  if (Object.keys(envVarsWithTokens).length === 0) {
    outputChannel.appendLine('No GitHub tokens found in environment variables');
    const tryManually = await vscode.window.showQuickPick(['Yes', 'No'], {
      placeHolder: 'No GitHub tokens found in environment variables. Would you like to enter one manually?'
    });
    
    if (tryManually === 'Yes') {
      return await enterTokenManually(context, owner, repo);
    } else {
      outputChannel.appendLine('User chose not to enter a token manually');
      await context.globalState.update('tokenSource', TokenSource.None);
      return undefined;
    }
  }
  
  outputChannel.appendLine(`Found ${Object.keys(envVarsWithTokens).length} potential GitHub tokens in environment variables`);
  
  // Validate each token and use the first valid one
  for (const [key, value] of Object.entries(envVarsWithTokens)) {
    outputChannel.appendLine(`Testing token from ${key}...`);
    if (await validateGitHubToken(value, owner, repo)) {
      outputChannel.appendLine(`Token from ${key} is valid`);
      // Save preference
      await context.globalState.update('tokenSource', TokenSource.Environment);
      await context.globalState.update('preferredEnvToken', key);
      return value;
    } else {
      outputChannel.appendLine(`Token from ${key} is invalid`);
    }
  }
  
  // If no valid tokens found, ask if user wants to enter one manually
  outputChannel.appendLine('No valid GitHub tokens found in environment variables');
  const tryManually = await vscode.window.showQuickPick(['Yes', 'No'], {
    placeHolder: 'No valid GitHub tokens found in environment variables. Would you like to enter one manually?'
  });
  
  if (tryManually === 'Yes') {
    return await enterTokenManually(context, owner, repo);
  } else {
    outputChannel.appendLine('User chose not to enter a token manually');
    await context.globalState.update('tokenSource', TokenSource.None);
    return undefined;
  }
}

// Function to enter a token manually
async function enterTokenManually(context: vscode.ExtensionContext, owner: string, repo: string): Promise<string | undefined | null> {
  while (true) {
    const token = await vscode.window.showInputBox({
      prompt: 'Enter your GitHub personal access token',
      password: true
    });
    
    if (!token) {
      outputChannel.appendLine('Token entry cancelled');
      return null; // User cancelled
    }
    
    outputChannel.appendLine('Testing manually entered token...');
    if (await validateGitHubToken(token, owner, repo)) {
      outputChannel.appendLine('Manually entered token is valid');
      
      const saveToken = await vscode.window.showQuickPick(['Yes', 'No'], {
        placeHolder: 'Save token for future use?'
      });
      
      if (saveToken === 'Yes') {
        await context.globalState.update('githubToken', token);
        await context.globalState.update('tokenSource', TokenSource.Saved);
        outputChannel.appendLine('GitHub token saved for future use');
      }
      
      return token;
    } else {
      outputChannel.appendLine('Manually entered token is invalid');
      const tryAgain = await vscode.window.showQuickPick(['Yes', 'No'], {
        placeHolder: 'Token is invalid. Would you like to try again?'
      });
      
      if (tryAgain !== 'Yes') {
        outputChannel.appendLine('User chose not to try again');
        return null;
      }
    }
  }
}

// Function to validate a GitHub token
async function validateGitHubToken(token: string, owner: string, repo: string): Promise<boolean> {
  try {
    outputChannel.appendLine('Validating GitHub token...');
    const octokit = new Octokit({ auth: token });
    
    // Try to get the repository to validate the token
    const response = await octokit.repos.get({
      owner,
      repo
    });
    
    outputChannel.appendLine(`Token validation successful (${response.status})`);
    return true;
  } catch (error: any) {
    outputChannel.appendLine(`Token validation failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

// Function to extract description from MDC file content
export function extractDescription(content: string): string | null {
  try {
    // Look for the frontmatter section
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    
    if (frontmatterMatch && frontmatterMatch[1]) {
      // Extract description from frontmatter
      const descriptionMatch = frontmatterMatch[1].match(/description:\s*(.*?)(?:\n|$)/);
      
      if (descriptionMatch && descriptionMatch[1]) {
        return descriptionMatch[1].trim();
      }
    }
    
    return null;
  } catch (error) {
    outputChannel.appendLine(`Error extracting description: ${error instanceof Error ? error.message : String(error)}`);
    console.error('Error extracting description:', error);
    return null;
  }
}

async function downloadFile(url: string, token?: string): Promise<string | null> {
  try {
    outputChannel.appendLine(`Downloading mdc file...`);
    
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `token ${token}`;
    }
    
    const response = await axios.get(url, { headers });
    return response.data;
  } catch (error) {
    const errorMsg = `Error downloading file: ${error instanceof Error ? error.message : String(error)}`;
    outputChannel.appendLine(errorMsg);
    console.error(errorMsg, error);
    return null;
  }
}

export function deactivate() {
  outputChannel.appendLine('Cursor MDC Rules Sync extension deactivated');
} 