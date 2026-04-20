# Agent Approval UX — Severity-Tiered Redesign

**Date**: 2026-04-20
**Status**: Approved for planning
**Branch**: extends `feat/agent-integration`
**Scope**: security/trust axis of the agent UI review pass (Phase D polish)

## Problem

After the Phase D subagent integration, every agent tool that requires approval produces the same modal:

> **PERMISSION REQUIRED**
> The agent wants to run a command that was flagged as potentially dangerous.

This is true for `read_file` on `~/Desktop/notes.md`, for `mkdir ~/Desktop/x`, for `rm -rf ~/Desktop/photos/`, and for `curl https://example.com`. Because the modal, copy, and keyboard shortcut (Enter = Allow) are identical across all of them, users develop reflexive muscle-memory Allow behavior. This is **alarm fatigue**, and it is the failure mode that turns "safe-by-default agent" into "I didn't read it, I just pressed Enter, the agent deleted my files."

The current approval modal gives no visual, textual, or behavioral signal of *impact*. There is also no feedback when the 60-second remember cache auto-resolves a future identical approval — the tool just silently runs, leaving the user unsure whether they approved it or the agent bypassed consent.

## Goals

1. Calibrate the approval UX so the friction of approving matches the risk of the action.
2. Make destructive operations deliberately hard to approve by reflex.
3. Give users visible confirmation when a cached "remember" decision fires.
4. Render shell commands as shell commands (`$ mkdir …`), not as pretty-printed JSON.

## Non-goals

- Per-user setting to auto-allow the `read` tier (follow-up).
- User-configurable severity overrides (follow-up).
- Diff preview for file writes (follow-up).
- Per-session approval log / audit panel (follow-up).

## Design

### §1 Backend severity classifier

A pure function in `sidecar/agent_bridge.py`:

```python
Severity = Literal["read", "write", "destructive", "network", "unknown"]

def classify_tool_severity(tool_name: str, args: dict) -> Severity:
    ...
```

Initial rule table:

| Match | Severity |
| --- | --- |
| `tool_name in {"read_file", "list_files", "grep", "glob"}` | `read` |
| `tool_name in {"write_file", "edit_file", "create_file"}` | `write` |
| `tool_name in {"delete_file"}` or name contains `rm`/`rmdir` | `destructive` |
| `tool_name == "terminal"` (see shell parser below) | from parser |
| `tool_name in {"http_get", "http_post", "fetch"}` | `network` |
| any arg value matches `http(s)://` | `network` |
| fallback | `unknown` |

Shell parser (for `tool_name == "terminal"`): strip `args.command`, read the first token, then:

| First token / pattern | Severity |
| --- | --- |
| `rm -rf`, `rm -r`, `mv`, `dd`, `git reset --hard`, `git push --force`, redirect `>` to non-tmp path | `destructive` |
| `curl`, `wget`, `ssh`, `scp`, `nc`, `telnet` | `network` |
| `mkdir`, `touch`, `cp`, `sed -i`, `vim`, `nano`, `code` | `write` |
| `ls`, `cat`, `head`, `tail`, `grep`, `find`, `pwd`, `echo`, `which` | `read` |
| anything else | `unknown` |

**Bias**: `unknown` is rendered by the frontend at the `write` (amber) tier, not `read`. We prefer an unnecessary approval prompt over a missed one.

**Caveat**: the actual bitidea-agent tool name for shell may be `shell` / `bash` / `execute_command`, not `terminal`. The implementation plan must verify against `~/Desktop/bitidea-agent/tools/` before committing the name.

### §2 SSE protocol changes

Extend two existing events. No new events.

**`approval_request`** gains `severity`:

```ts
{
  request_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  preview: string;
  severity: 'read' | 'write' | 'destructive' | 'network' | 'unknown';
}
```

**`tool_start`** gains two optional fields for the auto-allowed badge:

```ts
{
  id: string;
  name: string;
  args: Record<string, unknown>;
  preview: string;
  auto_allowed?: boolean;
  allowed_until_ms?: number;  // epoch ms, when the remember cache expires
}
```

**Back-compat**: when the frontend receives an `approval_request` without `severity`, it treats it as `unknown` (amber, `write`-like). When a `tool_start` lacks `auto_allowed`, no badge is rendered. Old clients work with new servers (they ignore the extra fields). Old servers do not exist in the wild — this is a local binary shipped with its own sidecar — so we can bump both in lockstep.

### §3 ApprovalModal — tiered rendering

One modal component, severity switches styling and copy via a lookup:

```ts
const SEV_CONFIG: Record<Severity, { color: string; glyph: string; title: Record<Lang,string>; sub: Record<Lang,string> }> = {
  read:        { color: 'var(--ink-dim)',  glyph: 'ℹ', title: { zh: '读取', en: 'Read' }, sub: { zh: '代理想读取以下资源', en: 'The agent wants to read:' } },
  write:       { color: 'var(--warning)',  glyph: '◆', title: { zh: '修改', en: 'Modify' }, sub: { zh: '代理想修改以下内容', en: 'The agent wants to modify:' } },
  destructive: { color: 'var(--danger)',   glyph: '⚠', title: { zh: '不可逆操作', en: 'Irreversible' }, sub: { zh: '代理想执行一个无法撤回的操作，请确认后再继续', en: 'The agent wants to take an irreversible action. Confirm before proceeding.' } },
  network:     { color: 'var(--info)',     glyph: '→', title: { zh: '网络请求', en: 'Network' }, sub: { zh: '代理想向外部服务发起请求', en: 'The agent wants to reach an external service:' } },
  unknown:     { color: 'var(--warning)',  glyph: '◆', title: { zh: '未分类操作', en: 'Unclassified' }, sub: { zh: '代理想执行一个未知类别的操作', en: 'The agent wants to take an action we could not classify:' } },
};
```

CSS: the card root gets `.approve-card.approve-{severity}`, and four per-tier classes override:
- Top stripe gradient color (currently hard-coded to `--warning`)
- `.approve-glyph` color + text-shadow
- `.approve-title` color

No other CSS changes.

### §4 Tool-specific preview rendering

A helper `renderToolPreview(tool_name, args) -> ReactNode` used in both the approval modal and the ToolCard header.

| Tool | Render |
| --- | --- |
| `terminal` with `args.command: string` | `<pre>$ {command}</pre>` — first token wrapped in `<span class="cmd-head">` for accent color |
| file write tools with `args.path` | `<span class="mono big">{path}</span>`, then if `args.content` and `len(content) < 400`: collapsed `▸ content` preview |
| network tools (`http_*`, or URL detected) | `<span class="method">{METHOD}</span> <span class="url">{URL}</span>`, then `▸ headers` collapsed if present |
| anything else | current behavior — pretty-printed JSON of `args` |

Only the modal changes the *default* for these tools. ToolCard also uses this helper for its one-line preview so the preview text matches what the user just approved.

### §5 Auto-allowed badge on ToolCard

**Backend**: `ApprovalRegistry.check_cache(tool_name, args)` returns `(allowed: bool, until_ms: int | None)`. When `allowed=True`, the bridge:
1. Does not emit `approval_request`.
2. Adds `auto_allowed=True, allowed_until_ms=until_ms` to the next `tool_start` event.

**Frontend**: `ToolCard` takes the two new optional props. When `auto_allowed`, render a small mono badge next to the caret:

```
[✓ 自动放行 · 42s]
```

A `useCountdown(allowed_until_ms)` hook recomputes remaining seconds every 1000ms via `setInterval`. When remaining <= 0, the badge fades out over 400ms (CSS opacity transition) but the card itself stays.

**Edge cases**:
- If the tool finishes before the 60s window expires, the countdown keeps ticking until 0 and then fades. The tool result is already visible; the badge is purely informational about the cache, not the tool.
- If `allowed_until_ms` is in the past when the frontend receives it (e.g. clock skew or delayed SSE), render `[✓ 自动放行]` without a countdown number.
- Only ONE badge is shown per ToolCard — if the same tool runs twice under the same remember cache, each card gets its own badge with its own countdown.

### §6 Destructive-tier friction

Additional behavior when `severity === 'destructive'`:

1. **Enter / Cmd+Enter** do not trigger Allow. Keydown handler early-returns for those keys when severity is destructive. Other severities keep current Enter-to-Allow behavior.
2. **Default focus** moves from Allow button to Deny button (safe default).
3. **Allow button** requires a pointer click (`mousedown`/`click`). The button stays keyboard-focusable for screen-reader discoverability, but pressing Enter or Space while it is focused is a no-op — the `onKeyDown` handler on the button early-returns for destructive severity. This is a deliberate a11y trade-off: destructive approval is a fully manual action, and a screen-reader user gets the same friction a sighted user does. The button's `aria-description` explicitly says "Click required — keyboard shortcuts are disabled for this action."
4. **"Remember 60 seconds" checkbox** is hidden for destructive requests. Destructive actions cannot be cached.
5. **Esc** remains instant-Deny.

## Data flow

```
┌────────────────────┐                       ┌─────────────────┐
│ bitidea-agent      │  approval_callback()  │ sidecar bridge  │
│ (sync tool thread) │──────────────────────▶│ agent_bridge.py │
└────────────────────┘                       └─────────────────┘
                                                      │
                                  classify_tool_severity()
                                                      │
                            remember cache hit? ──yes──▶ resolve True, mark next tool_start as auto_allowed
                                                      │ no
                                                      ▼
                                           push approval_request SSE
                                                      │
                                                      ▼
                                           ┌─────────────────┐
                                           │ ApprovalModal   │
                                           │ (React)         │
                                           └─────────────────┘
                                                      │
                               user decision (+ optional remember)
                                                      ▼
                                           POST /approval
                                                      │
                                     resolve pending future
                                                      ▼
                                    bitidea-agent unblocks, runs tool
```

## Testing strategy

The test surface is the severity classifier (pure function — easy) and the modal behavior (needs focused keyboard tests).

- **Unit** `sidecar/tests/test_severity.py`: table-driven tests for `classify_tool_severity` covering all rule rows plus edge cases (`rm -rf /` vs `rm` without args, `git push` vs `git push --force`, mixed-case, leading whitespace).
- **Unit** `sidecar/tests/test_approval_cache.py`: cache hit/miss, expiry, destructive bypass (destructive must never cache).
- **Component** `src/components/Chat/__tests__/ApprovalModal.test.tsx`: render each severity, assert copy/color class, Enter for destructive does nothing, Esc always denies, Deny is default focused for destructive.
- **Manual smoke**: the existing user scripts — creating a folder (write tier), then asking for deletion (destructive tier), then asking to curl an API (network tier) — all three must look visibly different.

## Risks

1. **Classifier false negatives.** Shell is not a regular language and we won't catch everything. Bias toward `unknown`/`write` mitigates silent passthrough. Follow-up: add user override.
2. **Wrong tool names.** Implementation must verify actual bitidea-agent tool registry before hard-coding the rule table. If names differ, the classifier reduces to `unknown` → write tier, which is safe but loud.
3. **Cache key stability.** `sha256(json.dumps(args, sort_keys=True))` is the key. Non-serializable args would crash. Bridge must catch and fall back to `no_cache=True` for that request.
4. **Clock skew.** `allowed_until_ms` is computed server-side; if system clock changes during the 60s window, frontend countdown shows wrong number. Acceptable — the server's cache is still authoritative.

## Out of scope (follow-ups)

- Settings toggle "auto-approve all `read` requests" — backend supports it via extended cache TTL, but UI not built in this pass.
- User-defined severity overrides (e.g., "this npm command is safe for me").
- File write diff preview.
- Approval log panel (session history of who approved what).
- Internationalization of the shell token list (currently Unix-only assumptions).

## Deliverable checklist

- [ ] `sidecar/agent_bridge.py`: `classify_tool_severity`, cache API updated, SSE events extended
- [ ] `sidecar/tests/test_severity.py` + `test_approval_cache.py`
- [ ] `src/types/index.ts`: `Severity`, `ApprovalRequest.severity`, `ToolEvent.auto_allowed`/`allowed_until_ms`
- [ ] `src/lib/sidecar.ts`: parse severity from SSE; no API shape change for consumer
- [ ] `src/components/Chat/ApprovalModal.tsx` + `.css`: severity config, copy, focus rules, destructive friction
- [ ] `src/components/Chat/ToolCard.tsx` + `.css`: auto-allowed badge, `useCountdown` hook
- [ ] `src/components/Chat/renderToolPreview.tsx` (new): shared helper for modal + card
- [ ] `npx tsc --noEmit` clean
- [ ] `pytest sidecar/tests` green
- [ ] Manual smoke: write / destructive / network / remember-replay all visibly distinct
