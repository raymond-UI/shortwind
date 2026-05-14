import type {
  Diagnostic,
  ParsedRecipeFile,
  Recipe,
  RecipeFileHeader,
  Result,
} from "./types.js";

const RECIPE_KW = "@recipe";

export function parseRecipeFile(
  source: string,
  filename: string,
): Result<ParsedRecipeFile, Diagnostic[]> {
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);

  const errors: Diagnostic[] = [];
  const recipes: Recipe[] = [];
  let header: RecipeFileHeader | null = null;
  let pendingDescription: string | null = null;

  const end = source.length;
  let pos = 0;
  let line = 1;
  let col = 1;

  const peek = (offset = 0): string => source[pos + offset] ?? "";
  const starts = (s: string): boolean => source.startsWith(s, pos);

  const isWS = (ch: string): boolean =>
    ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
  const isIdentStart = (ch: string): boolean => /[A-Za-z_]/.test(ch);
  const isIdentCont = (ch: string): boolean => /[A-Za-z0-9_-]/.test(ch);

  const advance = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      if (pos >= end) return;
      if (source[pos] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      pos++;
    }
  };

  const skipWhitespace = (): void => {
    while (pos < end && isWS(peek())) advance();
  };

  const readComment = (): { body: string; startLine: number; startCol: number } | null => {
    const startLine = line;
    const startCol = col;
    advance(2);
    const bodyStart = pos;
    while (pos < end && !(source[pos] === "*" && source[pos + 1] === "/")) {
      advance();
    }
    if (pos >= end) {
      errors.push({
        code: "parse/unterminated-comment",
        message: "unterminated block comment",
        file: filename,
        line: startLine,
        column: startCol,
      });
      return null;
    }
    const body = source.slice(bodyStart, pos);
    advance(2);
    return { body: body.trim(), startLine, startCol };
  };

  const tryParseHeader = (body: string, startLine: number): RecipeFileHeader | null => {
    const m = body.match(/^shortwind:\s+(\S+)@(\S+)\s+sha:(\S+)/);
    if (!m) return null;
    return {
      family: m[1] ?? "",
      version: m[2] ?? "",
      sha: m[3] ?? "",
      sourceLine: startLine,
    };
  };

  const skipBody = (): void => {
    let depth = 1;
    while (pos < end && depth > 0) {
      if (starts("/*")) {
        readComment();
        continue;
      }
      const ch = peek();
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      advance();
    }
  };

  const parseBody = (
    recipeName: string,
    recipeLine: number,
    openBraceCol: number,
  ): { tokens: string[]; references: string[] } => {
    const tokens: string[] = [];
    const references: string[] = [];

    while (pos < end) {
      skipWhitespace();
      if (pos >= end) break;

      if (peek() === "}") {
        advance();
        return { tokens, references };
      }

      if (starts("/*")) {
        readComment();
        continue;
      }

      if (peek() === ";") {
        errors.push({
          code: "parse/semicolon-in-body",
          message: "recipe bodies are class lists, not CSS — remove the ';'",
          file: filename,
          line,
          column: col,
        });
        advance();
        continue;
      }

      const tokenStart = pos;
      while (
        pos < end &&
        !isWS(peek()) &&
        peek() !== ";" &&
        peek() !== "}" &&
        !starts("/*")
      ) {
        advance();
      }
      const token = source.slice(tokenStart, pos);
      if (token.length === 0) {
        advance();
        continue;
      }
      tokens.push(token);
      if (token.startsWith("@")) references.push(token.slice(1));
    }

    errors.push({
      code: "parse/missing-brace",
      message: `missing closing '}' for recipe '${recipeName}'`,
      file: filename,
      line: recipeLine,
      column: openBraceCol,
    });
    return { tokens, references };
  };

  const readRecipe = (): void => {
    const startLine = line;
    advance(RECIPE_KW.length);
    skipWhitespace();

    if (pos >= end || !isIdentStart(peek())) {
      errors.push({
        code: "parse/missing-name",
        message: "expected recipe name after '@recipe'",
        file: filename,
        line: startLine,
        column: col,
      });
      while (pos < end && peek() !== "{") advance();
      if (pos < end) {
        advance();
        skipBody();
      }
      pendingDescription = null;
      return;
    }

    const nameStart = pos;
    while (pos < end && isIdentCont(peek())) advance();
    const name = source.slice(nameStart, pos);

    skipWhitespace();

    if (pos >= end || peek() !== "{") {
      errors.push({
        code: "parse/missing-open-brace",
        message: `expected '{' after recipe name '${name}'`,
        file: filename,
        line: startLine,
        column: col,
      });
      pendingDescription = null;
      return;
    }

    const braceCol = col;
    advance();

    const body = parseBody(name, startLine, braceCol);

    recipes.push({
      name,
      description: pendingDescription,
      tokens: body.tokens,
      references: body.references,
      sourceFile: filename,
      sourceLine: startLine,
    });
    pendingDescription = null;
  };

  while (pos < end) {
    skipWhitespace();
    if (pos >= end) break;

    if (starts("/*")) {
      const onLineOne = line === 1;
      const c = readComment();
      if (!c) continue;
      if (onLineOne && header === null) {
        const h = tryParseHeader(c.body, c.startLine);
        if (h) {
          header = h;
          continue;
        }
      }
      pendingDescription = c.body;
      continue;
    }

    if (
      starts(RECIPE_KW) &&
      (pos + RECIPE_KW.length >= end ||
        isWS(source[pos + RECIPE_KW.length] ?? "") ||
        source[pos + RECIPE_KW.length] === "{")
    ) {
      readRecipe();
      continue;
    }

    errors.push({
      code: "parse/unexpected",
      message: `unexpected character '${peek()}' at top level`,
      file: filename,
      line,
      column: col,
    });
    advance();
    pendingDescription = null;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { header, recipes } };
}
