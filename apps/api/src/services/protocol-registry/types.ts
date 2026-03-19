/**
 * Protocol Registry Types
 * Epic 49, Story 49.1: Type definitions for protocol discovery
 */

export type ProtocolId = 'x402' | 'ap2' | 'acp' | 'ucp' | 'mpp';

export type ProtocolStatus = 'stable' | 'beta' | 'experimental' | 'deprecated';

export interface ProtocolPrerequisites {
  /** Requires a USDC wallet */
  wallet?: boolean;
  /** Requires a connected payment handler */
  paymentHandler?: boolean;
  /** Minimum KYA tier required */
  kyaLevel?: number;
  /** Other feature flags required */
  features?: string[];
}

export interface ProtocolDocs {
  overview: string;
  quickstart: string;
  api: string;
}

export interface Protocol {
  id: ProtocolId;
  name: string;
  description: string;
  version: string;
  status: ProtocolStatus;
  prerequisites: ProtocolPrerequisites;
  capabilities: string[];
  docs: ProtocolDocs;
}

export interface ProtocolEnablementStatus {
  enabled: boolean;
  enabled_at?: string;
  prerequisites_met: boolean;
  missing_prerequisites: string[];
}

export interface OrganizationProtocolStatus {
  protocols: Record<ProtocolId, ProtocolEnablementStatus>;
}

export interface EnableProtocolResult {
  success: boolean;
  protocol: ProtocolId;
  enabled_at?: string;
  error?: string;
  missing_prerequisites?: string[];
}
