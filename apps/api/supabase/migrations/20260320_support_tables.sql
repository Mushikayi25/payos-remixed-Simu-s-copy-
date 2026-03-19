-- ============================================
-- Support Tables for Intercom Fin MCP Tools
-- ============================================

-- Limit increase requests (from agents via Fin)
CREATE TABLE IF NOT EXISTS limit_increase_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  limit_type VARCHAR(20) NOT NULL CHECK (limit_type IN ('per_transaction', 'daily', 'monthly')),
  current_limit DECIMAL(20,8) NOT NULL,
  requested_amount DECIMAL(20,8) NOT NULL,
  reason TEXT NOT NULL,
  duration VARCHAR(20) NOT NULL DEFAULT 'permanent' CHECK (duration IN ('temporary_24h', 'temporary_7d', 'permanent')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  decided_by UUID REFERENCES user_profiles(id),
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_limit_requests_tenant_status ON limit_increase_requests(tenant_id, status);
CREATE INDEX idx_limit_requests_agent_status ON limit_increase_requests(agent_id, status);

-- Support escalations (from agents/Fin to human operators)
CREATE TABLE IF NOT EXISTS support_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  agent_id UUID REFERENCES agents(id),
  reason VARCHAR(50) NOT NULL CHECK (reason IN ('complex_issue', 'agent_requested', 'security_concern', 'policy_exception', 'bug_report')),
  summary TEXT NOT NULL,
  priority VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'resolved', 'closed')),
  assigned_to VARCHAR(255),
  estimated_response_time VARCHAR(50),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_escalations_tenant_status ON support_escalations(tenant_id, status);
CREATE INDEX idx_escalations_priority_status ON support_escalations(priority, status);

-- ============================================
-- RLS Policies
-- ============================================

ALTER TABLE limit_increase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_escalations ENABLE ROW LEVEL SECURITY;

-- Limit increase requests: tenant isolation
CREATE POLICY limit_requests_tenant_select ON limit_increase_requests
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY limit_requests_tenant_insert ON limit_increase_requests
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY limit_requests_tenant_update ON limit_increase_requests
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Service role bypass for limit_increase_requests
CREATE POLICY limit_requests_service_role ON limit_increase_requests
  FOR ALL USING (current_setting('role', true) = 'service_role');

-- Support escalations: tenant isolation
CREATE POLICY escalations_tenant_select ON support_escalations
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY escalations_tenant_insert ON support_escalations
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY escalations_tenant_update ON support_escalations
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Service role bypass for support_escalations
CREATE POLICY escalations_service_role ON support_escalations
  FOR ALL USING (current_setting('role', true) = 'service_role');
