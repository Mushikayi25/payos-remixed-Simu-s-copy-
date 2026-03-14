-- ============================================
-- Migration: Contract Policy Engine Tables
-- Epic 18: Agent Wallets & Contract Policies
--
-- Creates:
--   1. counterparty_exposures — rolling per-counterparty exposure windows
--   2. policy_evaluations — audit log of every policy decision
--   3. Extends wallets.spending_policy schema (documentation only; JSONB is schemaless)
-- ============================================

-- ============================================
-- 1. Counterparty Exposures Table
-- Tracks rolling 24h/7d/30d exposure per counterparty per wallet.
-- ============================================

CREATE TABLE counterparty_exposures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,

  -- Counterparty identification (one of these must be set)
  counterparty_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  counterparty_address TEXT,

  -- Rolling exposure windows (updated on each payment/escrow)
  exposure_24h DECIMAL(15,4) NOT NULL DEFAULT 0,
  exposure_7d DECIMAL(15,4) NOT NULL DEFAULT 0,
  exposure_30d DECIMAL(15,4) NOT NULL DEFAULT 0,

  -- Active contract counts
  active_contracts INTEGER NOT NULL DEFAULT 0,
  active_escrows INTEGER NOT NULL DEFAULT 0,

  -- Total lifetime exposure
  total_volume DECIMAL(15,4) NOT NULL DEFAULT 0,
  transaction_count INTEGER NOT NULL DEFAULT 0,

  currency TEXT NOT NULL DEFAULT 'USDC',

  -- Window reset tracking
  last_24h_reset_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_7d_reset_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_30d_reset_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Constraint: at least one counterparty identifier must be set
  CONSTRAINT chk_counterparty_id CHECK (
    counterparty_agent_id IS NOT NULL OR counterparty_address IS NOT NULL
  )
);

COMMENT ON TABLE counterparty_exposures IS 'Per-counterparty rolling exposure windows for contract policy enforcement (Epic 18)';
COMMENT ON COLUMN counterparty_exposures.exposure_24h IS 'Rolling 24-hour exposure amount in wallet currency';
COMMENT ON COLUMN counterparty_exposures.exposure_7d IS 'Rolling 7-day exposure amount in wallet currency';
COMMENT ON COLUMN counterparty_exposures.exposure_30d IS 'Rolling 30-day exposure amount in wallet currency';
COMMENT ON COLUMN counterparty_exposures.active_contracts IS 'Count of currently active contracts with this counterparty';
COMMENT ON COLUMN counterparty_exposures.active_escrows IS 'Count of currently active escrows with this counterparty';

-- Indexes
CREATE INDEX idx_cpty_exp_tenant ON counterparty_exposures(tenant_id);
CREATE INDEX idx_cpty_exp_wallet ON counterparty_exposures(wallet_id);
CREATE INDEX idx_cpty_exp_agent ON counterparty_exposures(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_cpty_exp_cpty_agent ON counterparty_exposures(counterparty_agent_id) WHERE counterparty_agent_id IS NOT NULL;
CREATE INDEX idx_cpty_exp_cpty_addr ON counterparty_exposures(counterparty_address) WHERE counterparty_address IS NOT NULL;

-- Unique constraint: one exposure record per wallet+counterparty pair
CREATE UNIQUE INDEX idx_cpty_exp_wallet_agent ON counterparty_exposures(wallet_id, counterparty_agent_id)
  WHERE counterparty_agent_id IS NOT NULL;
CREATE UNIQUE INDEX idx_cpty_exp_wallet_addr ON counterparty_exposures(wallet_id, counterparty_address)
  WHERE counterparty_address IS NOT NULL AND counterparty_agent_id IS NULL;

-- RLS
ALTER TABLE counterparty_exposures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "counterparty_exposures_tenant_isolation" ON counterparty_exposures
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Service role bypass
CREATE POLICY "counterparty_exposures_service_role" ON counterparty_exposures
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ============================================
-- 2. Policy Evaluations Audit Table
-- Immutable log of every contract policy decision.
-- ============================================

CREATE TABLE policy_evaluations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,

  -- What was evaluated
  action_type TEXT NOT NULL CHECK (action_type IN (
    'payment', 'escrow_create', 'escrow_release',
    'contract_sign', 'negotiation_check', 'counterparty_check'
  )),

  -- Counterparty
  counterparty_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  counterparty_address TEXT,

  -- Request details
  amount DECIMAL(15,4),
  currency TEXT DEFAULT 'USDC',
  contract_type TEXT,
  protocol TEXT,

  -- Decision
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'escalate', 'deny')),
  decision_reasons JSONB NOT NULL DEFAULT '[]',

  -- Counter-offer (when denied with suggestion)
  suggested_counter_offer JSONB DEFAULT NULL,
  -- { "max_amount": 50.00, "reason": "Exceeds 24h exposure cap" }

  -- Which checks ran and their results
  checks_performed JSONB NOT NULL DEFAULT '[]',
  -- [
  --   { "check": "spending_policy", "result": "pass", "detail": "..." },
  --   { "check": "counterparty_blocklist", "result": "fail", "detail": "..." },
  --   { "check": "exposure_24h", "result": "pass", "detail": "..." }
  -- ]

  -- Execution time
  evaluation_ms INTEGER,

  -- If escalated, link to approval
  approval_id UUID,

  -- Correlation
  correlation_id TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE policy_evaluations IS 'Immutable audit log of contract policy engine decisions (Epic 18)';
COMMENT ON COLUMN policy_evaluations.decision IS 'Policy decision: approve (auto-execute), escalate (needs human approval), deny (blocked)';
COMMENT ON COLUMN policy_evaluations.checks_performed IS 'Array of individual check results that contributed to the decision';

-- Indexes
CREATE INDEX idx_policy_eval_tenant ON policy_evaluations(tenant_id);
CREATE INDEX idx_policy_eval_wallet ON policy_evaluations(wallet_id);
CREATE INDEX idx_policy_eval_agent ON policy_evaluations(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX idx_policy_eval_decision ON policy_evaluations(decision);
CREATE INDEX idx_policy_eval_action ON policy_evaluations(action_type);
CREATE INDEX idx_policy_eval_created ON policy_evaluations(created_at DESC);
CREATE INDEX idx_policy_eval_correlation ON policy_evaluations(correlation_id) WHERE correlation_id IS NOT NULL;

-- RLS
ALTER TABLE policy_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "policy_evaluations_tenant_isolation" ON policy_evaluations
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "policy_evaluations_service_role" ON policy_evaluations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- ============================================
-- 3. Extended spending_policy JSONB Schema (documentation)
-- The wallets.spending_policy column now also supports:
-- ============================================
-- spending_policy structure extensions for contract policies:
-- {
--   // --- Existing fields (unchanged) ---
--   "dailySpendLimit": 100.00,
--   "monthlySpendLimit": 2000.00,
--   "requiresApprovalAbove": 50.00,
--   "approvedVendors": ["api.acme.com"],
--   "approvedCategories": ["compliance"],
--   "approvedEndpoints": ["ep-xxx"],
--
--   // --- New: Contract Policy Fields (Epic 18) ---
--   "contractPolicy": {
--     "counterpartyBlocklist": ["agent-id-1", "0xaddr..."],
--     "counterpartyAllowlist": ["agent-id-2"],
--     "minCounterpartyKyaTier": 1,
--     "minCounterpartyReputation": 0.5,
--     "allowedContractTypes": ["payment", "escrow", "subscription"],
--     "blockedContractTypes": ["loan"],
--     "maxExposure24h": 500.00,
--     "maxExposure7d": 2000.00,
--     "maxExposure30d": 5000.00,
--     "maxActiveContracts": 10,
--     "maxActiveEscrows": 5,
--     "escalateAbove": 100.00
--   }
-- }

-- Add comment to document the extended schema
COMMENT ON COLUMN wallets.spending_policy IS 'Spending limits, allowlists, and contract policy rules (Epic 18 extended). See migration 20260313_contract_policy_engine.sql for full schema.';
