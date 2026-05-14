import { createHash } from "node:crypto";

const HEADER_PATTERN = /^\/\*\s*shortwind:\s+(\S+)@(\S+)\s+sha:([^\s*]+)(?:\s+—\s+DO NOT EDIT THIS LINE)?\s*\*\/\s*$/;

export type RecipeHeader = {
  family: string;
  version: string;
  sha: string;
};

export function extractHeader(source: string): RecipeHeader | null {
  const eol = source.indexOf("\n");
  const firstLine = (eol === -1 ? source : source.slice(0, eol)).replace(/\r$/, "");
  const m = firstLine.match(HEADER_PATTERN);
  if (!m) return null;
  return { family: m[1] ?? "", version: m[2] ?? "", sha: m[3] ?? "" };
}

export function bodyAfterHeader(source: string): string {
  const eol = source.indexOf("\n");
  return eol === -1 ? "" : source.slice(eol + 1);
}

export function normalizeBody(body: string): string {
  const lf = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return lf
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/, ""))
    .join("\n");
}

export function computeBodySha(source: string): string {
  const normalized = normalizeBody(bodyAfterHeader(source));
  return createHash("sha256").update(normalized).digest("hex").slice(0, 6);
}

export function buildHeaderLine(family: string, version: string, sha: string): string {
  return `/* shortwind: ${family}@${version} sha:${sha} — DO NOT EDIT THIS LINE */`;
}

export function rewriteHeaderSha(source: string, sha: string): string {
  const header = extractHeader(source);
  if (!header) return source;
  const newHeader = buildHeaderLine(header.family, header.version, sha);
  const eol = source.indexOf("\n");
  if (eol === -1) return newHeader;
  return newHeader + source.slice(eol);
}

export function sealRecipeFile(source: string, family: string, version: string): string {
  const sha = computeBodySha(source);
  const header = buildHeaderLine(family, version, sha);
  const eol = source.indexOf("\n");
  const rest = eol === -1 ? "" : source.slice(eol);
  return header + rest;
}
