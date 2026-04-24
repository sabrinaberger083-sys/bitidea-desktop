# Attribution

Bitidea Agent is a rebranded fork of [Hermes Agent](https://github.com/NousResearch/hermes-agent) v0.10.0 by Nous Research, released under the MIT License.

Original project: https://github.com/NousResearch/hermes-agent
Original license: MIT (see [LICENSE](./LICENSE))

All credit for the core agent architecture — the agent loop, tool-call protocol,
environment harnesses, skill system, and CLI foundations — belongs to the Nous
Research team. This fork keeps the `LICENSE` file intact as required by MIT.

The "Hermes" name is retained in a handful of places where it refers to things
that legitimately still belong to Nous Research or are interoperability surfaces
(not Bitidea brand):

- `environments/tool_call_parsers/hermes_parser.py` — the Hermes tool-call
  format (XML `<tool_call>` tags) is a public interop protocol.
- The `_HERMES_MODEL_WARNING` detection for Nous Research's
  Hermes-3 / Hermes-4 chat models, which have specific non-agentic behavior.
- LLM model IDs (`NousResearch/Hermes-3-*`, `nous-hermes-3`, etc.) — these
  identify third-party model weights, not our product.
- `HermesToolCallParser` / `Hermes2ProToolParser` class names — protocol names.

Everything else — CLI branding, config directory (`~/.bitidea`), environment
variable prefix (`BITIDEA_*`), package names (`bitidea_cli`, `bitidea_constants`),
and command entry points (`bitidea`, `bitidea-agent`, `bitidea-acp`) — is the
Bitidea distribution.
