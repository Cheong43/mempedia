# mempedia Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill covers development patterns for the mempedia project, a Rust-based application with web interface components. The project follows a modular architecture with core functionality implemented in Rust and web UI components for user interaction. The development workflow emphasizes clean build artifact management, comprehensive documentation, and incremental feature development.

## Coding Conventions

### File Naming
- Use camelCase for file naming: `mainModule.rs`, `apiHandler.js`
- Web UI files follow standard naming: `index.html`, `script.js`, `styles.css`
- Documentation files use lowercase: `readme.md`, `SKILL.md`

### Project Structure
```
src/
├── core/mod.rs          # Core functionality
├── api/mod.rs           # API layer
└── */mod.rs             # Feature modules

*-UI/                    # Web interface
├── index.html
├── script.js
└── styles.css

skills/                  # Documentation
└── */SKILL.md
```

### Import/Export Style
- Mixed import style accommodating both Rust and JavaScript patterns
- Rust modules use standard `mod` declarations
- JavaScript uses modern ES6 import/export where applicable

## Workflows

### Gitignore Maintenance
**Trigger:** When build artifacts or unwanted files start being tracked by git
**Command:** `/update-gitignore`

1. Identify files and directories that should be ignored (build artifacts, IDE files, etc.)
2. Update `.gitignore` with new entries
3. Remove already tracked files from git if needed:
   ```bash
   git rm -r --cached target/
   git commit -m "chore: remove build artifacts from tracking"
   ```
4. Verify ignored files are no longer tracked

### Documentation Update
**Trigger:** When project features change or documentation needs refresh
**Command:** `/update-docs`

1. Update `readme.md` with new project information and features
2. Update skill documentation in `skills/*/SKILL.md` files
3. Sync agent configuration files in `skills/*/agents/openai.yaml`
4. Ensure documentation reflects current codebase state
5. Commit with descriptive message: `chore: update project documentation`

### Rust Build Cleanup
**Trigger:** When target/ directory and build artifacts get accidentally committed
**Command:** `/clean-rust-build`

1. Update `.gitignore` to exclude `target/` directory:
   ```gitignore
   target/
   *.lock
   *.pdb
   ```
2. Remove target directory from git tracking:
   ```bash
   git rm -r --cached target/
   ```
3. Clean up incremental build files and compilation artifacts
4. Commit cleanup: `chore: remove rust build artifacts`

### Web UI Development
**Trigger:** When developing or enhancing the web user interface
**Command:** `/update-ui`

1. Create or update HTML structure in `*-UI/index.html`
2. Update JavaScript functionality in `*-UI/script.js`
3. Style components with CSS in `*-UI/styles.css`
4. Test UI functionality across different browsers
5. Update project documentation to reflect UI changes
6. Commit with feature description

### Rust Module Enhancement
**Trigger:** When adding new features to the Rust codebase
**Command:** `/enhance-rust-module`

1. Update core module functionality in `src/core/mod.rs`:
   ```rust
   pub mod new_feature;
   pub use new_feature::*;
   ```
2. Extend API module in `src/api/mod.rs` to expose new functionality
3. Update related modules and their `mod.rs` files
4. Update documentation in `readme.md` and `skills/*/SKILL.md`
5. Test new functionality
6. Commit with clear feature description

## Testing Patterns

- Test files follow the pattern `*.test.*`
- Testing framework not explicitly detected, likely using Rust's built-in testing
- Tests should be placed alongside source code or in dedicated test directories
- Run tests with `cargo test` for Rust components

## Commands

| Command | Purpose |
|---------|---------|
| `/update-gitignore` | Add entries to gitignore and clean up tracked artifacts |
| `/update-docs` | Refresh project documentation and skill files |
| `/clean-rust-build` | Remove Rust build artifacts from version control |
| `/update-ui` | Develop or enhance web interface components |
| `/enhance-rust-module` | Add new functionality to Rust modules and update APIs |