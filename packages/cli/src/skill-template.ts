export function renderSkillMd(families: string[]): string {
  const familyList = families.length === 0 ? "(none yet — add some with `shortwind add <family>`)" : families.map((f) => `- ${f}`).join("\n");
  return `---
name: shortwind
description: Token-efficient class layer for Tailwind. Use @recipe shortcuts in HTML/JSX class lists to compose pre-built clusters of utilities. Build expands them to full Tailwind class strings.
---

# Shortwind

Shortwind defines named **recipes** like \`@card\` that expand into Tailwind class strings at build time. Use recipes wherever you write \`class=\` or \`className=\`. Combine recipes with raw Tailwind utilities — the last-wins conflict resolver (tailwind-merge) handles overlap.

## Usage

\`\`\`html
<div class="@card-elevated p-6"><h2 class="@heading-md">Hello</h2></div>
\`\`\`

In JSX/TSX, the same works with \`className\`, including template literals: \`className={\\\`@btn-primary \${active ? "ring-2" : ""}\\\`}\`.

## Available families

${familyList}

Run \`shortwind ls\` to list every recipe in this project, or \`shortwind add <family>\` to pull in more.

## Rules

- Names look like \`@<family>[-<intent>][-<size>]\` — \`@btn-primary-lg\`, \`@card-elevated\`, \`@heading-xl\`.
- Recipes already include hover/focus states where relevant — don't restate them.
- Recipes already include dark-mode variants — don't restate them.
- Conflicts resolve last-wins. If a recipe sets \`p-4\` and you append \`p-6\`, the final output has \`p-6\`.
`;
}
