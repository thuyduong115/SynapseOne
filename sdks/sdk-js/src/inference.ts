// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 VKU.VIC
/*
 * Copyright 2026 SynapseOne Contributors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * Synapse Inference Engine client: OpenRouter LLM proxy, self-hosted lightweight
 * embeddings, and self-hosted Decision-2.0-Eos-0.8B structured routing.
 */

import { HttpClient, INFERENCE_TIMEOUT_MS, RequestOptions } from './_http';

const P = '/v1/inference';
/** LLM calls are allowed 120s by the gateway route; the SDK must match it. */
const INFERENCE_OPTS: RequestOptions = { timeoutMs: INFERENCE_TIMEOUT_MS };

export interface InferenceHealthResponse {
  status: string;
  service: string;
  version: string;
  models: {
    llm: string;
    embedding: string;
    decision: string;
  };
  components: {
    llm: {
      provider: string;
      configured: boolean;
      base_url?: string;
    };
    embedding: {
      model: string;
      dimension: number;
      loaded: boolean;
      device: string;
      mock_mode: boolean;
      error?: string | null;
    };
    decision: {
      model: string;
      architecture: string;
      loaded: boolean;
      device: string;
      mock_mode: boolean;
      error?: string | null;
    };
  };
  time: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | string;
  content: string;
  name?: string;
}

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface EmbeddingItem {
  object: 'embedding';
  index: number;
  embedding: number[];
}

export interface EmbeddingResponse {
  object: 'list';
  data: EmbeddingItem[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface DecisionQuestion {
  type: 'choice' | 'noul' | 'score' | string;
  instructions: string;
  criteria?: Record<string, string>;
}

export interface DecisionResponse {
  model: string;
  results: Record<string, any>;
  duration_ms: number;
}

export interface RouteResponse {
  best_choice: string;
  confidence: number;
  probabilities: Record<string, number>;
  model: string;
  duration_ms: number;
}

export class InferenceService {
  constructor(private readonly http: HttpClient) {}
  /** Check health and status of inference subsystems (LLM, embedding, decision). */
  health(): Promise<InferenceHealthResponse> {
    return this.http.req<InferenceHealthResponse>(`${P}/health`);
  }

  /** Run chat completions through the OpenRouter-backed LLM proxy. */
  chat(messages: ChatMessage[], opts: ChatCompletionOptions = {}, reqOpts: RequestOptions = {}): Promise<ChatCompletionResponse> {
    return this.http.req<ChatCompletionResponse>(`${P}/chat/completions`, {
      method: 'POST',
      body: JSON.stringify({
        messages,
        ...opts,
      }),
    }, { ...INFERENCE_OPTS, ...reqOpts });
  }

  /**
   * Stream chat completions token-by-token (OpenAI-compatible SSE).
   *
   * Yields `{event, data}` records where `data` is the raw SSE payload; use
   * {@link parseChatDelta} to read the incremental text. Pass `{signal}` to
   * cancel the request (the underlying fetch is aborted).
   *
   * ```ts
   * for await (const ev of client.inference.chatStream(msgs, {}, { signal })) {
   *   const delta = parseChatDelta(ev.data);
   *   if (delta) process.stdout.write(delta);
   * }
   * ```
   */
  chatStream(messages: ChatMessage[], opts: ChatCompletionOptions = {}, reqOpts: RequestOptions = {}): AsyncGenerator<{ event: string; data: string }> {
    return this.http.stream(`${P}/chat/completions`, {
      method: 'POST',
      body: JSON.stringify({ messages, ...opts, stream: true }),
    }, { ...INFERENCE_OPTS, ...reqOpts });
  }

  /** Generate text embeddings using the self-hosted lightweight model. */
  embeddings(input: string | string[], opts: { model?: string } = {}, reqOpts: RequestOptions = {}): Promise<EmbeddingResponse> {
    return this.http.req<EmbeddingResponse>(`${P}/embeddings`, {
      method: 'POST',
      body: JSON.stringify({
        input,
        ...opts,
      }),
    }, { ...INFERENCE_OPTS, ...reqOpts });
  }

  /** Run structured question evaluation via Decision-2.0-Eos-0.8B (system_one). */
  decision(state: string, questions: Record<string, DecisionQuestion>, reqOpts: RequestOptions = {}): Promise<DecisionResponse> {
    return this.http.req<DecisionResponse>(`${P}/decision`, {
      method: 'POST',
      body: JSON.stringify({
        state,
        questions,
      }),
    }, { ...INFERENCE_OPTS, ...reqOpts });
  }

  /** Semantic route an input text between candidate choices for workflow branching. */
  route(input: string, choices: Record<string, string>, instruction?: string, reqOpts: RequestOptions = {}): Promise<RouteResponse> {
    return this.http.req<RouteResponse>(`${P}/decision/route`, {
      method: 'POST',
      body: JSON.stringify({
        input,
        choices,
        ...(instruction ? { instruction } : {}),
      }),
    }, { ...INFERENCE_OPTS, ...reqOpts });
  }
}

/**
 * Extract the incremental assistant text from one SSE `data:` payload.
 * Returns `null` for `[DONE]`, keep-alives and frames without content.
 */
export function parseChatDelta(data: string): string | null {
  if (!data || data === '[DONE]') return null;
  try {
    const j: any = JSON.parse(data);
    const choice = j?.choices?.[0];
    const delta = choice?.delta?.content ?? choice?.message?.content;
    if (typeof delta === 'string' && delta.length) return delta;
    if (typeof j?.content === 'string' && j.content.length) return j.content;
    return null;
  } catch {
    return data;
  }
}
