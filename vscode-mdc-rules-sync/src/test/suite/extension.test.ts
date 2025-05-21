import * as assert from 'assert';
import * as vscode from 'vscode';

// Import the extension module to test internal functions
import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Starting tests...');

  test('Extension should be present', async () => {
    // The extension ID should match the name in package.json with publisher
    const extension = vscode.extensions.getExtension('cursor-rules.vscode-mdc-rules-sync');
    assert.ok(extension, 'Extension should be available');
  });

  test('Should register commands', async () => {
    // Wait a bit for commands to register
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const commands = await vscode.commands.getCommands();
    assert.ok(commands.includes('vscode-mdc-rules-sync.syncRules'), 
      'Command vscode-mdc-rules-sync.syncRules should be registered');
  });

  test('Should extract description from MDC content', () => {
    // Access the extractDescription function using the any type to bypass TypeScript's visibility restrictions
    const extractDescription = (myExtension as any).extractDescription;
    
    if (typeof extractDescription !== 'function') {
      assert.fail('extractDescription function not found in extension');
      return;
    }
    
    // Test with valid MDC content
    const validContent = `---
description: This is a test description
globs: 
alwaysApply: false
---
# Test Content
Some content here`;
    
    const description = extractDescription(validContent);
    assert.strictEqual(description, 'This is a test description', 'Should extract the correct description');
    
    // Test with no description
    const noDescriptionContent = `---
globs: 
alwaysApply: false
---
# Test Content`;
    
    const noDescription = extractDescription(noDescriptionContent);
    assert.strictEqual(noDescription, null, 'Should return null when no description is found');
    
    // Test with invalid content
    const invalidContent = `# Just some markdown
No frontmatter here`;
    
    const invalidResult = extractDescription(invalidContent);
    assert.strictEqual(invalidResult, null, 'Should return null for invalid content');
  });
}); 