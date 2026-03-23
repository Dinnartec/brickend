export function gitignoreTemplate(): string {
	return `# dependencies
node_modules

# environment
.env
.env.local
.env.*.local

# output
dist

# IDE
.idea
.vscode
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# logs
*.log
`;
}
