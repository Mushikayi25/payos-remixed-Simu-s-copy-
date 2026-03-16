# Epic 68: Flexible Skill Pricing

**Status:** Backlog
**Phase:** 5.3 (Agent Economics)
**Priority:** P1
**Total Points:** 52
**Stories:** 11
**Dependencies:** Epic 57 (A2A Protocol), Epic 58 (Task Processor)
**Linear Project:** [Epic 68](https://linear.app/sly-ai/project/epic-68-flexible-skill-pricing-bc4e63ae1b45)
**Created:** March 16, 2026

## Overview

Today every A2A skill has a flat `base_price` — same fee for every caller, every invocation, every context. Real agent economies need richer pricing: KYA-tiered rates that reward verification, per-caller discounts for partners, dynamic quotes computed from request complexity, and negotiated prices within the A2A multi-turn lifecycle.

The A2A protocol's `input-required` task state naturally supports a negotiate-then-pay flow. This epic adds a price resolution layer between skill lookup and settlement mandate creation, plus the Agent Card extensions and management APIs to configure it.

## Executive Summary

**Problem:** Flat `base_price` per skill is too rigid for real agent economies. Verified agents overpay, partners can't get volume discounts, and complex tasks can't price dynamically.

**Solution:** A price resolution layer with four models — KYA-tiered rates, per-caller overrides, dynamic quotes via `input-required`, and negotiated pricing via A2A multi-turn — all resolved before settlement mandate creation.

**Why now:** Epic 57 (A2A) and Epic 58 (Task Processor) are complete. Skills execute and settle. Pricing flexibility is the next unlock for agent marketplace growth.

---

## SDK Impact Assessment

| Feature/Endpoint | Needs SDK? | Module | Priority | Notes |
|---|---|---|---|---|
| `resolveSkillPrice()` | ❌ No | - | - | Internal service |
| `urn:a2a:ext:pricing` card extension | ❌ No | - | - | A2A protocol |
| `PATCH /v1/agents/:id/skills/:skillId/pricing` | ✅ Yes | `sly.agents` | P2 | Pricing management |
| `GET /v1/agents/:id/skills/:skillId/pricing` | ✅ Yes | `sly.agents` | P2 | Read pricing config |
| `skill_pricing_overrides` CRUD | ✅ Yes | `sly.agents` | P2 | Caller-specific rates |

**SDK Stories Required:**
- [ ] Update `sly.agents` module with pricing management methods (post-Epic 68)

---

## How Each Pricing Model Maps to A2A

**1. Tiered by KYA** — Platform resolves price based on caller's KYA tier before mandate creation. Transparent to callers — they just see a lower price. Configured via `tiered_pricing` in skill metadata.

**2. Per-caller overrides** — New `skill_pricing_overrides` table. Provider agent sets custom prices for specific caller agents (e.g., partner discount). Task processor checks overrides before falling back to tier/base pricing.

**3. Dynamic/computed** — Agent's own endpoint receives the task, computes price based on request payload (input size, model, complexity), and returns `input-required` with a quote. Caller accepts → settlement at quoted price. Fully agent-driven, no platform changes for the pricing logic itself.

**4. Negotiated per-task** — Caller proposes a price in the task message. Agent accepts, rejects, or counter-offers via `input-required`. Multi-turn A2A conversation about price before execution. Uses task metadata to track negotiation state.

## Resolution Order

```
1. Check skill_pricing_overrides for (skill_id, caller_agent_id) → use if found
2. Check skill.metadata.tiered_pricing for caller's KYA tier → use if tier matches
3. Check task metadata for accepted negotiated/dynamic quote → use if present
4. Fall back to skill.base_price
```

---

## Stories

### Phase 1: Price Resolution Foundation — 13 pts

| Story | Linear | Points | Priority | Labels | Status |
|-------|--------|--------|----------|--------|--------|
| 68.1: Price resolver service | [SLY-443](https://linear.app/sly-ai/issue/SLY-443) | 5 | High | Engineering | Backlog |
| 68.2: Tiered pricing by KYA tier | [SLY-444](https://linear.app/sly-ai/issue/SLY-444) | 3 | High | Engineering | Backlog |
| 68.3: Per-caller pricing overrides table | [SLY-445](https://linear.app/sly-ai/issue/SLY-445) | 5 | High | Engineering, DB | Backlog |

#### Story Details

**68.1: Price resolver service (5 pts)**
Create `apps/api/src/services/a2a/price-resolver.ts`. Single function `resolveSkillPrice()` that takes skill record, caller agent ID, caller KYA tier, and task metadata. Returns `{ amount, currency, method }`. Resolution order: caller override → KYA tier → base price. Pure function with DB lookups.

**68.2: Tiered pricing by KYA tier (3 pts)**
Support `tiered_pricing` config in `agent_skills.metadata`:
```json
{ "tiered_pricing": { "0": 0.20, "1": 0.10, "2": 0.05, "3": 0.02 } }
```
Price resolver checks caller's KYA tier against this map. Falls back to `base_price` if no tier match or no tiered config.

**68.3: Per-caller pricing overrides table (5 pts)**
Migration: `apps/api/supabase/migrations/20260316_skill_pricing_overrides.sql`
- `skill_pricing_overrides` table with RLS
- Columns: `tenant_id`, `skill_id` (FK agent_skills), `caller_agent_id` (FK agents), `price`, `currency`, `valid_from`, `valid_until`
- Unique constraint on `(skill_id, caller_agent_id)` where `valid_until IS NULL`
- RLS policy: tenant isolation

### Phase 2: Task Processor Integration — 10 pts

| Story | Linear | Points | Priority | Labels | Status |
|-------|--------|--------|----------|--------|--------|
| 68.4: Wire price resolver into task processor | [SLY-446](https://linear.app/sly-ai/issue/SLY-446) | 5 | High | Engineering | Backlog |
| 68.5: Agent card pricing extension | [SLY-447](https://linear.app/sly-ai/issue/SLY-447) | 5 | Medium | Engineering | Backlog |

#### Story Details

**68.4: Wire price resolver into task processor (5 pts)**
Replace hardcoded `Number(skill.base_price)` in `task-processor.ts` (lines 845, 869, 913) with `resolveSkillPrice()` call. Ensure caller's KYA tier is available at charge point. Log resolved price method in task metadata for audit.

**68.5: Agent card pricing extension (5 pts)**
Add `urn:a2a:ext:pricing` extension to per-agent Agent Cards in `agent-card.ts`:
```json
{
  "uri": "urn:a2a:ext:pricing",
  "data": {
    "models": ["fixed"],
    "quoteSupported": false
  }
}
```
Models array populated dynamically: `"fixed"` always, `"tiered"` if skill has tiered_pricing, `"negotiable"` if skill metadata says so. Per-skill `base_price` already shown — add `tiered_pricing` summary if configured.

### Phase 3: Dynamic & Negotiated Pricing — 13 pts

| Story | Linear | Points | Priority | Labels | Status |
|-------|--------|--------|----------|--------|--------|
| 68.6: Quote-then-pay flow | [SLY-448](https://linear.app/sly-ai/issue/SLY-448) | 8 | Medium | Engineering | Backlog |
| 68.7: Caller-proposed pricing | [SLY-449](https://linear.app/sly-ai/issue/SLY-449) | 5 | Medium | Engineering | Backlog |

#### Story Details

**68.6: Quote-then-pay flow (8 pts)**
When an agent endpoint returns `input-required` with `reason_code: 'price_quote'` and `details.quoted_price`, the task processor stores the quote in task metadata. When the caller resumes the task (accepts), the settlement mandate uses the quoted price instead of base_price. Add quote expiry check (default 5 min TTL).

**68.7: Caller-proposed pricing (5 pts)**
When a caller includes `{ offered_price: N }` in task message data, the task processor stores it in metadata. If the agent's skill allows negotiation (`metadata.negotiable: true`), the offer is forwarded to the agent. Agent can accept (proceed at offered price), reject (fail with reason), or counter-offer (input-required with counter price).

### Phase 4: Management API — 8 pts

| Story | Linear | Points | Priority | Labels | Status |
|-------|--------|--------|----------|--------|--------|
| 68.8: Pricing configuration endpoints | [SLY-450](https://linear.app/sly-ai/issue/SLY-450) | 5 | Medium | Engineering, API | Backlog |
| 68.9: A2A self-service pricing update | [SLY-451](https://linear.app/sly-ai/issue/SLY-451) | 3 | Low | Engineering | Backlog |

#### Story Details

**68.8: Pricing configuration endpoints (5 pts)**
- `GET /v1/agents/:id/skills/:skillId/pricing` — returns current pricing config (base, tiered, overrides)
- `PATCH /v1/agents/:id/skills/:skillId/pricing` — set tiered pricing, toggle negotiable
- `POST /v1/agents/:id/skills/:skillId/pricing/overrides` — add caller-specific override
- `DELETE /v1/agents/:id/skills/:skillId/pricing/overrides/:callerId` — remove override
Auth: API key or agent token (self-sovereign).

**68.9: A2A self-service pricing update (3 pts)**
Extend the `update_agent` A2A skill in `onboarding-handler.ts` to accept pricing config in skill updates. Agent can set tiered pricing and caller overrides via `message/send` to the platform gateway.

### Phase 5: Testing & Documentation — 8 pts

| Story | Linear | Points | Priority | Labels | Status |
|-------|--------|--------|----------|--------|--------|
| 68.10: Unit tests | [SLY-452](https://linear.app/sly-ai/issue/SLY-452) | 5 | High | Engineering, Testing | Backlog |
| 68.11: Developer documentation | [SLY-453](https://linear.app/sly-ai/issue/SLY-453) | 3 | Low | Docs | Backlog |

#### Story Details

**68.10: Unit tests (5 pts)**
- Price resolver: all resolution paths (base, tiered, override, negotiated)
- Task processor: verify resolved price flows through to mandate
- Agent card: pricing extension appears correctly
- Edge cases: expired overrides, missing tier, no config

**68.11: Developer documentation (3 pts)**
Document pricing models in agent onboarding docs. Include examples for each model. Add pricing section to Agent Card spec. Document A2A quote flow with sequence diagram.

---

## Dependencies

```
68.1 (resolver) ──→ 68.4 (task processor wiring)
68.2 (tiered)   ──→ 68.4
68.3 (overrides table) ──→ 68.4
                       ──→ 68.8 (management API)

68.4 (task processor) ──→ 68.6 (quote-then-pay)
                      ──→ 68.7 (caller-proposed)

68.1 (resolver) ──→ 68.5 (agent card extension)

68.8 (management API) ──→ 68.9 (A2A self-service)

68.4 (task processor) ──→ 68.10 (unit tests)
68.6 (quote-then-pay) ──→ 68.10

68.6 (quote-then-pay)    ──→ 68.11 (docs)
68.7 (caller-proposed)   ──→ 68.11
```

### Critical Path

`68.1 + 68.2 + 68.3 → 68.4 → 68.6 → 68.10`

### Parallel Tracks

- **Foundation track:** 68.1, 68.2, 68.3 (all parallel)
- **Integration track:** 68.4 → 68.6, 68.7 (after foundation)
- **Card track:** 68.5 (after 68.1)
- **API track:** 68.8 (after 68.3) → 68.9
- **Validation track:** 68.10, 68.11 (after integration)

---

## Key Files

| File | Change |
|---|---|
| `apps/api/src/services/a2a/price-resolver.ts` | NEW — price resolution logic |
| `apps/api/src/services/a2a/task-processor.ts` | Replace `base_price` lookups |
| `apps/api/src/services/a2a/agent-card.ts` | Add pricing extension |
| `apps/api/src/services/a2a/onboarding-handler.ts` | Pricing in update_agent |
| `apps/api/src/routes/agents.ts` | Pricing management endpoints |
| `apps/api/supabase/migrations/20260316_skill_pricing_overrides.sql` | New table |
| `apps/api/tests/unit/price-resolver.test.ts` | NEW — tests |

## Security

- Pricing overrides scoped by `tenant_id` with RLS
- Only the provider agent (or tenant API key) can set pricing — callers cannot modify prices
- Quote expiry prevents stale price acceptance
- All pricing decisions logged in task metadata for audit

## Design Decisions

1. **Resolution order: override → tiered → base** — Most specific wins. Caller overrides take priority over tier-based pricing to enable partner deals.
2. **Tiered pricing in skill metadata** — No new table needed for tier config. `agent_skills.metadata` already supports JSON. Keeps schema simple.
3. **Separate overrides table** — Per-caller pricing needs its own table for proper indexing, validity windows, and audit trail.
4. **Quote expiry** — 5 min default prevents stale quotes from being accepted after market conditions change.
5. **A2A `input-required` for negotiation** — Reuses existing A2A protocol mechanics. No new protocol extensions needed for dynamic/negotiated pricing.
6. **Agent-driven dynamic pricing** — Platform doesn't need to understand pricing logic. Agent computes price and returns it via `input-required`. Clean separation of concerns.
