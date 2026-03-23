# Contributing to Brickend

Thanks for your interest in contributing to Brickend! This guide will help you get started.

## Development Setup

### Prerequisites

- [Bun](https://bun.sh/) v1.0+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for Supabase local dev)
- [Git](https://git-scm.com/)

### Getting Started

```bash
git clone https://github.com/dinnartec/brickend.git
cd brickend
bun install
```

### Running in Development

```bash
bun run dev          # Run CLI with file watching
bun test             # Run all tests
bun test --watch     # Watch mode
bunx biome check .   # Lint + format check
```

## Project Structure

```
src/
  cli/       # Commander.js CLI commands (init, add, lint)
  core/      # Core engine (generator, linter, brick-loader, state)
    templates/  # Code generation templates (SQL, TypeScript)
bricks/      # Brick definitions (*.brick.yaml)
  templates/ # Project templates (*.template.yaml)
tests/       # Unit tests (mirrors src/ structure)
demos/       # Reference implementation
```

## Code Style

- **Formatter:** [Biome](https://biomejs.dev/) — tabs, double quotes, 100 char line width
- **TypeScript:** Strict mode with `verbatimModuleSyntax` and `noUncheckedIndexedAccess`
- **Imports:** Always use `.ts` extensions

Run `bunx biome check --fix .` to auto-fix formatting issues before submitting.

## Making Changes

### Workflow

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add or update tests for any new functionality
4. Ensure all tests pass: `bun test`
5. Ensure linting passes: `bunx biome check .`
6. Submit a pull request to `main`

### Adding a New Brick

1. Create `bricks/<name>/<name>.brick.yaml` following the [brick spec](docs/brick-spec.md)
2. Add `access:` rules for RBAC
3. Run `bun run dev -- lint` to validate the spec
4. Add tests in `tests/bricks/bricks.test.ts`

### Modifying the Generator

The generator (`src/core/generator.ts`) builds TypeScript and SQL as string arrays. When making changes:

- Update `demos/supabase/` to match the expected output
- Add/update tests in `tests/core/generator.test.ts`
- Test with a real `brickend init` to verify end-to-end

## Pull Requests

- Keep PRs focused — one feature or fix per PR
- Write a clear description of what changed and why
- Include test coverage for new functionality
- Reference any related issues

## Reporting Bugs

Open an issue at [github.com/dinnartec/brickend/issues](https://github.com/dinnartec/brickend/issues) with:

- Steps to reproduce
- Expected vs actual behavior
- Brickend version (`brickend --version`)
- OS and Bun version

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
