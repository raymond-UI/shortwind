// Minimal OpenRouter chat client. OpenRouter speaks the OpenAI
// chat-completions shape, so this is a thin fetch wrapper — no SDK dependency,
// which keeps the package free of supply-chain surface.

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GenerateOptions = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};

export type Generation = {
  text: string;
  model: string;
  // Raw usage if the provider reports it; null when absent.
  usage: { promptTokens: number; completionTokens: number } | null;
};

export interface ModelClient {
  readonly id: string;
  generate(opts: GenerateOptions): Promise<Generation>;
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export class OpenRouterError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "OpenRouterError";
  }
}

export type OpenRouterClientOptions = {
  apiKey: string;
  // OpenRouter asks integrators to identify themselves; harmless if omitted.
  referer?: string;
  title?: string;
  fetchImpl?: typeof fetch;
};

export function createOpenRouterClient(options: OpenRouterClientOptions): ModelClient {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    id: "openrouter",
    async generate(opts: GenerateOptions): Promise<Generation> {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      };
      if (options.referer) headers["HTTP-Referer"] = options.referer;
      if (options.title) headers["X-Title"] = options.title;

      const body = {
        model: opts.model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      };

      const res = await doFetch(ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new OpenRouterError(
          res.status,
          `OpenRouter ${res.status} for ${opts.model}: ${detail.slice(0, 300)}`,
        );
      }

      // A 200 with a non-JSON body (proxy error page, truncated stream) makes
      // res.json() reject; wrap it so the failure names the model instead of a
      // bare SyntaxError.
      let json: {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      try {
        json = (await res.json()) as typeof json;
      } catch (err) {
        throw new OpenRouterError(
          res.status,
          `OpenRouter ${opts.model}: 200 OK but body was not valid JSON — ${(err as Error).message}`,
        );
      }
      const text = json.choices?.[0]?.message?.content ?? "";
      const usage = json.usage
        ? {
            promptTokens: json.usage.prompt_tokens ?? 0,
            completionTokens: json.usage.completion_tokens ?? 0,
          }
        : null;
      return { text, model: opts.model, usage };
    },
  };
}
