# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 VKU.VIC
# Copyright 2026 SynapseOne Contributors
# Licensed under the Apache License, Version 2.0 (the "License");
"""Synapse Inference Engine client for Python."""

from __future__ import annotations

from typing import Any, Iterator

from ._http import INFERENCE_TIMEOUT, HttpClient, iter_text, parse_chat_delta

_PREFIX = "/v1/inference"


class InferenceService:
    """Namespace for Synapse Inference Engine operations."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def health(self) -> dict[str, Any]:
        """Check health and subsystem readiness of the inference engine."""
        return self._http.get(f"{_PREFIX}/health", timeout=INFERENCE_TIMEOUT)

    def chat(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        stream: bool = False,
        **extra: Any,
    ) -> dict[str, Any]:
        """Run chat completions through the OpenRouter-backed LLM proxy.

        LLM calls get the 120s inference budget (the SDK default is 15s).
        Use :meth:`chat_stream` for token-by-token SSE.
        """
        body: dict[str, Any] = {"messages": messages, "stream": stream, **extra}
        if model is not None:
            body["model"] = model
        if temperature is not None:
            body["temperature"] = temperature
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        return self._http.post(
            f"{_PREFIX}/chat/completions", body, timeout=INFERENCE_TIMEOUT
        )

    def chat_stream(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        **extra: Any,
    ) -> Iterator[tuple[str, str]]:
        """Stream chat completions as ``(event, data)`` SSE records.

        Use :func:`synapseone_sdk.iter_text` or
        :func:`synapseone_sdk.parse_chat_delta` to extract incremental text::

            for chunk in iter_text(client.inference.chat_stream(msgs)):
                print(chunk, end="", flush=True)
        """
        body: dict[str, Any] = {"messages": messages, "stream": True, **extra}
        if model is not None:
            body["model"] = model
        if temperature is not None:
            body["temperature"] = temperature
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        return self._http.stream("POST", f"{_PREFIX}/chat/completions", body)

    def chat_text(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        **extra: Any,
    ) -> Iterator[str]:
        """Stream only the incremental assistant text."""
        return iter_text(
            self.chat_stream(
                messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                **extra,
            )
        )

    def embeddings(
        self,
        inputs: str | list[str],
        model: str | None = None,
        **extra: Any,
    ) -> dict[str, Any]:
        """Generate text embeddings using the self-hosted lightweight model."""
        body: dict[str, Any] = {"input": inputs, **extra}
        if model is not None:
            body["model"] = model
        return self._http.post(f"{_PREFIX}/embeddings", body, timeout=INFERENCE_TIMEOUT)

    def decision(
        self,
        state: str,
        questions: dict[str, Any],
    ) -> dict[str, Any]:
        """Evaluate structured questions via Decision-2.0-Eos-0.8B (system_one)."""
        body = {"state": state, "questions": questions}
        return self._http.post(f"{_PREFIX}/decision", body, timeout=INFERENCE_TIMEOUT)

    def route(
        self,
        input_text: str,
        choices: dict[str, str],
        instruction: str = "",
    ) -> dict[str, Any]:
        """Semantic route an input text between candidate choices for workflow branching."""
        body: dict[str, Any] = {"input": input_text, "choices": choices}
        if instruction:
            body["instruction"] = instruction
        return self._http.post(
            f"{_PREFIX}/decision/route", body, timeout=INFERENCE_TIMEOUT
        )


__all__ = ["InferenceService", "parse_chat_delta"]
