# Contributing to BRASS Proof

Thank you for your interest in contributing to BRASS Proof! This document provides guidelines and instructions for contributing to our open-source packages.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Package Development](#package-development)
- [Testing](#testing)
- [Publishing](#publishing)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)

## Development Setup

### Prerequisites

- Node.js 18+ and npm
- Git
- (Optional) Wrangler CLI for Cloudflare Worker development

### Initial Setup

1. **Clone the repository:**

```bash
git clone https://github.com/brassproof/brass-proof.git
cd brass-proof
```

2. **Install dependencies for all packages:**

```bash
# Install root dependencies
npm install

# Install dependencies for each package
cd packages/brass-verifier && npm install && cd ../..
cd packages/brass-nextjs && npm install && cd ../..
cd packages/brass-cloudflare && npm install && cd ../..
cd cli && npm install && cd ..
```

3. **Build all packages:**

```bash
npm run build:all
```

## Project Structure

```
brass-proof/
├── brass-abuse-shield/       # Next.js template application
│   ├── app/                  # Next.js App Router pages
│   ├── components/           # React components
│   └── public/               # Static assets
├── packages/
│   ├── brass-verifier/       # Core verifier SDK
│   │   ├── src/              # Source code
│   │   ├── docs/             # Documentation
│   │   └── examples/         # Usage examples
│   ├── brass-nextjs/         # Next.js integration
│   │   └── src/              # React hooks and helpers
│   └── brass-cloudflare/     # Cloudflare Worker integration
│       └── src/              # Worker helpers
├── cli/                      # Project scaffolder CLI
│   └── src/                  # CLI source code
├── commercial/               # Commercial documentation
└── worker/                   # Cloudflare Worker implementations
```

## Package Development

### @brassproof/verifier

Core BRASS protocol verifier.

**Development:**

```bash
cd packages/brass-verifier
npm run dev              # Watch mode
npm run build            # Production build
npm run lint             # Lint code
npm test                 # Run tests
```

**Key files:**
- `src/index.ts` - Main verifier implementation
- `src/types.ts` - TypeScript type definitions
- `docs/verifier.md` - Self-hosting documentation

### @brassproof/nextjs

Next.js integration with React hooks and API helpers.

**Development:**

```bash
cd packages/brass-nextjs
npm run dev              # Watch mode
npm run build            # Production build
npm run lint             # Lint code
```

**Key files:**
- `src/use-brass.ts` - React hook for client-side
- `src/with-brass-verifier.ts` - API route middleware
- `src/index.ts` - Package exports

### @brassproof/cloudflare

Cloudflare Worker integration.

**Development:**

```bash
cd packages/brass-cloudflare
npm run dev              # Watch mode
npm run build            # Production build
npm run lint             # Lint code
```

**Key files:**
- `src/index.ts` - Worker helper implementation

### @brassproof/create

CLI tool for scaffolding projects.

**Development:**

```bash
cd cli
npm run dev              # Watch mode
npm run build            # Production build

# Test locally
npm link
brass create next-app test-app
```

**Key files:**
- `src/index.ts` - CLI implementation

## Testing

### Unit Tests

Run unit tests for a specific package:

```bash
cd packages/brass-verifier
npm test
```

### Integration Tests

Test the full integration by creating a sample app:

```bash
# Using the CLI
npx @brassproof/create create next-app test-app
cd test-app
npm install
npm run dev
```

### Manual Testing

1. Start the brass-abuse-shield demo app:

```bash
cd brass-abuse-shield
npm install
npm run dev
```

2. Visit http://localhost:3000 and test the demo

## Publishing

All packages use semantic versioning and are published to npm.

### Pre-publish Checklist

- [ ] All tests pass
- [ ] Documentation is updated
- [ ] CHANGELOG.md is updated
- [ ] Version numbers are bumped appropriately
- [ ] No TypeScript errors (`npm run build`)
- [ ] No linting errors (`npm run lint`)

### Publishing a Package

```bash
# 1. Update version
cd packages/brass-verifier
npm version patch|minor|major

# 2. Build
npm run build

# 3. Publish
npm publish --access public

# 4. Tag release
git tag @brassproof/verifier@1.0.1
git push origin @brassproof/verifier@1.0.1
```

### Publishing Order

When updating multiple packages with dependencies:

1. `@brassproof/verifier` (core, no dependencies)
2. `@brassproof/nextjs` (depends on verifier)
3. `@brassproof/cloudflare` (depends on verifier)
4. `@brassproof/create` (depends on all packages)

## Code Style

### TypeScript

- Use TypeScript for all packages
- Enable strict mode
- Provide comprehensive type definitions
- Export all public types

### Linting

All packages use ESLint with TypeScript support:

```bash
npm run lint
```

### Formatting

- Use 2 spaces for indentation
- Use semicolons
- Use single quotes for strings
- Add trailing commas in multiline objects/arrays

### Comments

- Use JSDoc for public APIs
- Include examples in documentation
- Explain complex algorithms
- Avoid obvious comments

**Good:**

```typescript
/**
 * Verifies a BRASS token and enforces rate limits.
 * 
 * @param payload - The BRASS spend payload from the client
 * @param context - Verification context including origin and scope
 * @returns Verification result with success status and rate limit info
 * 
 * @example
 * ```typescript
 * const result = await verifier.verify(payload, {
 *   origin: 'https://example.com',
 *   scope: 'comment-submission',
 * })
 * ```
 */
async verify(payload: BrassSpendPayload, context: VerificationContext): Promise<VerificationResult>
```

## Pull Request Process

### Before Submitting

1. **Create an issue** describing the bug or feature
2. **Fork the repository** and create a branch from `main`
3. **Make your changes** following the code style guidelines
4. **Add tests** for new functionality
5. **Update documentation** in README.md and JSDoc comments
6. **Run all tests** and ensure they pass
7. **Lint your code** with `npm run lint`

### Submitting

1. **Commit your changes** with clear, descriptive messages:

```bash
git commit -m "feat(verifier): add support for custom rate limit windows"
```

2. **Push to your fork:**

```bash
git push origin feature/custom-rate-limits
```

3. **Open a Pull Request** with:
   - Clear title describing the change
   - Description linking to the related issue
   - Screenshots/examples if applicable
   - Test results
   - Breaking changes (if any)

### Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**

```
feat(nextjs): add useBrass hook for client-side token minting

fix(verifier): correct DLEQ proof validation edge case

docs(cloudflare): update deployment instructions

chore: bump dependencies to latest versions
```

### Review Process

1. Maintainers will review your PR
2. Address any requested changes
3. Once approved, maintainers will merge

## Security

If you discover a security vulnerability, please email security@brassproof.com instead of opening a public issue.

## Questions?

- **Documentation:** https://docs.brassproof.com
- **Discord:** https://discord.gg/brassproof
- **Email:** support@brassproof.com

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

Thank you for contributing to BRASS Proof! 🛡️
