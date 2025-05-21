# Change Log

All notable changes to the "vscode-mdc-rules-sync" extension will be documented in this file.


## [0.3.1] - Token Validation and Auto-Detection

- Clear token from logs

## [0.3.0] - Token Validation and Auto-Detection

- Added token validation before saving to ensure tokens work
- Added automatic detection of GitHub tokens in environment variables that start with 'ghp_'
- Added improved token selection workflow with clear options
- Added retry mechanism for invalid tokens
- Added validation against the target repository to ensure access

## [0.2.0] - Token Preference and Management

- Added token preference saving (remembers your choice of token source)
- Added token management option in the file selection list
- Added automatic detection of invalid tokens with clear error messages
- Added better handling of authentication errors
- Improved token source selection with environment variable preferences

## [0.1.0] - Initial Release

- Initial release of the Cursor MDC Rules Sync extension
- Ability to connect to a GitHub repository (default: YOUR-ORG/global-cursor-rules)
- List and select MDC files (*.mdc) from the repository
- Display descriptions from MDC files to help users choose the right files
- Copy selected files to your local .cursor/rules folder
- Compare differences when files already exist
- Options to overwrite, keep current, or manually merge changes 