import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================
// Test: Expression Evaluator
// ============================================

// We'll test the expression evaluator logic directly
// (exported indirectly via the engine's condition step behavior)

describe('Expression Evaluation (internal)', () => {
  // Reimplement for direct testing since the evaluator is private
  function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  function parseValue(raw: string): unknown {
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1);
    }
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;
    const num = Number(raw);
    if (!isNaN(num)) return num;
    return raw;
  }

  function compareValues(a: unknown, op: string, b: unknown): boolean {
    switch (op) {
      case '==': return a == b;
      case '!=': return a != b;
      case '>': return Number(a) > Number(b);
      case '<': return Number(a) < Number(b);
      case '>=': return Number(a) >= Number(b);
      case '<=': return Number(a) <= Number(b);
      case 'contains': return String(a).includes(String(b));
      case 'starts_with': return String(a).startsWith(String(b));
      default: return false;
    }
  }

  function evaluateExpression(expression: string, data: Record<string, unknown>): boolean {
    try {
      const comparisonMatch = expression.match(
        /^(\w+(?:\.\w+)*)\s*(==|!=|>=|<=|>|<|contains|starts_with)\s*(.+)$/
      );
      if (comparisonMatch) {
        const [, fieldPath, operator, rawValue] = comparisonMatch;
        const fieldValue = getNestedValue(data, fieldPath);
        const compareValue = parseValue(rawValue.trim());
        return compareValues(fieldValue, operator, compareValue);
      }
      const boolMatch = expression.match(/^(\w+(?:\.\w+)*)$/);
      if (boolMatch) {
        return !!getNestedValue(data, boolMatch[1]);
      }
      const negMatch = expression.match(/^!(\w+(?:\.\w+)*)$/);
      if (negMatch) {
        return !getNestedValue(data, negMatch[1]);
      }
      return false;
    } catch {
      return false;
    }
  }

  describe('getNestedValue', () => {
    it('gets top-level values', () => {
      expect(getNestedValue({ foo: 'bar' }, 'foo')).toBe('bar');
    });

    it('gets nested values', () => {
      expect(getNestedValue({ trigger: { amount: 5000 } }, 'trigger.amount')).toBe(5000);
    });

    it('gets deeply nested values', () => {
      expect(getNestedValue({ a: { b: { c: true } } }, 'a.b.c')).toBe(true);
    });

    it('returns undefined for missing paths', () => {
      expect(getNestedValue({ foo: 'bar' }, 'baz')).toBeUndefined();
      expect(getNestedValue({ foo: 'bar' }, 'foo.bar')).toBeUndefined();
    });

    it('handles null/undefined gracefully', () => {
      expect(getNestedValue({ foo: null }, 'foo.bar')).toBeUndefined();
    });
  });

  describe('parseValue', () => {
    it('parses numbers', () => {
      expect(parseValue('42')).toBe(42);
      expect(parseValue('3.14')).toBe(3.14);
      expect(parseValue('0')).toBe(0);
    });

    it('parses booleans', () => {
      expect(parseValue('true')).toBe(true);
      expect(parseValue('false')).toBe(false);
    });

    it('parses null', () => {
      expect(parseValue('null')).toBe(null);
    });

    it('parses quoted strings', () => {
      expect(parseValue('"hello"')).toBe('hello');
      expect(parseValue("'world'")).toBe('world');
    });

    it('returns raw string for unrecognized values', () => {
      expect(parseValue('procurement')).toBe('procurement');
    });
  });

  describe('evaluateExpression', () => {
    const data = {
      trigger: {
        amount: 5000,
        type: 'procurement',
        is_urgent: true,
      },
      context: {
        approved: false,
      },
    };

    it('evaluates numeric comparisons', () => {
      expect(evaluateExpression('trigger.amount > 1000', data)).toBe(true);
      expect(evaluateExpression('trigger.amount < 1000', data)).toBe(false);
      expect(evaluateExpression('trigger.amount >= 5000', data)).toBe(true);
      expect(evaluateExpression('trigger.amount <= 5000', data)).toBe(true);
      expect(evaluateExpression('trigger.amount == 5000', data)).toBe(true);
      expect(evaluateExpression('trigger.amount != 5000', data)).toBe(false);
    });

    it('evaluates string comparisons', () => {
      expect(evaluateExpression('trigger.type == "procurement"', data)).toBe(true);
      expect(evaluateExpression('trigger.type != "expense"', data)).toBe(true);
    });

    it('evaluates contains operator', () => {
      expect(evaluateExpression('trigger.type contains "proc"', data)).toBe(true);
      expect(evaluateExpression('trigger.type contains "xyz"', data)).toBe(false);
    });

    it('evaluates starts_with operator', () => {
      expect(evaluateExpression('trigger.type starts_with "proc"', data)).toBe(true);
      expect(evaluateExpression('trigger.type starts_with "xyz"', data)).toBe(false);
    });

    it('evaluates boolean field access', () => {
      expect(evaluateExpression('trigger.is_urgent', data)).toBe(true);
      expect(evaluateExpression('context.approved', data)).toBe(false);
    });

    it('evaluates negation', () => {
      expect(evaluateExpression('!trigger.is_urgent', data)).toBe(false);
      expect(evaluateExpression('!context.approved', data)).toBe(true);
    });

    it('returns false for invalid expressions', () => {
      expect(evaluateExpression('', data)).toBe(false);
      expect(evaluateExpression('invalid expression here', data)).toBe(false);
    });

    it('returns false for missing fields', () => {
      expect(evaluateExpression('trigger.nonexistent > 0', data)).toBe(false);
    });
  });
});

// ============================================
// Test: Template Variable Interpolation
// ============================================

describe('Template Interpolation (internal)', () => {
  function interpolateTemplate(template: string, data: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path) => {
      const parts = path.split('.');
      let current: unknown = data;
      for (const part of parts) {
        if (current === null || current === undefined) return '';
        if (typeof current !== 'object') return '';
        current = (current as Record<string, unknown>)[part];
      }
      return current !== undefined ? String(current) : '';
    });
  }

  it('interpolates simple variables', () => {
    expect(interpolateTemplate('Hello {{name}}', { name: 'World' })).toBe('Hello World');
  });

  it('interpolates nested variables', () => {
    expect(interpolateTemplate(
      'Transfer {{trigger.id}} for {{trigger.amount}}',
      { trigger: { id: 'txn_123', amount: 5000 } }
    )).toBe('Transfer txn_123 for 5000');
  });

  it('replaces missing variables with empty string', () => {
    expect(interpolateTemplate('Value: {{missing}}', {})).toBe('Value: ');
  });

  it('handles no variables', () => {
    expect(interpolateTemplate('No variables here', {})).toBe('No variables here');
  });

  it('handles multiple variables', () => {
    expect(interpolateTemplate(
      '{{a}} and {{b}} and {{c}}',
      { a: '1', b: '2', c: '3' }
    )).toBe('1 and 2 and 3');
  });
});

// ============================================
// Test: Workflow Engine Service (with Supabase mock)
// ============================================

describe('WorkflowEngine', () => {
  // Mock Supabase client
  function createMockSupabase() {
    const mockData: Record<string, any[]> = {
      workflow_templates: [],
      workflow_instances: [],
      workflow_step_executions: [],
      agent_workflow_permissions: [],
      tenants: [{ id: 'tenant-1', webhook_url: null }],
    };

    function createQueryBuilder(table: string) {
      let filters: Array<{ field: string; value: any; op: string }> = [];
      let insertData: any = null;
      let updateData: any = null;
      let selectFields: string = '*';
      let rangeStart = 0;
      let rangeEnd = 100;
      let orderField: string | null = null;
      let orderAsc = true;
      let isSingle = false;
      let isDelete = false;
      let isUpsert = false;
      let countMode: string | null = null;

      const builder: any = {
        select: (fields?: string, opts?: any) => {
          selectFields = fields || '*';
          if (opts?.count === 'exact') countMode = 'exact';
          return builder;
        },
        insert: (data: any) => {
          insertData = data;
          return builder;
        },
        update: (data: any) => {
          updateData = data;
          return builder;
        },
        upsert: (data: any, _opts?: any) => {
          insertData = data;
          isUpsert = true;
          return builder;
        },
        delete: () => {
          isDelete = true;
          return builder;
        },
        eq: (field: string, value: any) => {
          filters.push({ field, value, op: 'eq' });
          return builder;
        },
        in: (field: string, values: any[]) => {
          filters.push({ field, value: values, op: 'in' });
          return builder;
        },
        order: (field: string, opts?: any) => {
          orderField = field;
          orderAsc = opts?.ascending ?? true;
          return builder;
        },
        range: (start: number, end: number) => {
          rangeStart = start;
          rangeEnd = end;
          return builder;
        },
        single: () => {
          isSingle = true;
          return builder;
        },
        then: (resolve: any) => {
          // Execute the query
          let items = [...(mockData[table] || [])];

          if (insertData) {
            if (Array.isArray(insertData)) {
              for (const item of insertData) {
                const newItem = {
                  ...item,
                  id: item.id || `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                };
                mockData[table] = mockData[table] || [];
                mockData[table].push(newItem);
                items.push(newItem);
              }
              items = items.slice(-insertData.length);
            } else {
              const newItem = {
                ...insertData,
                id: insertData.id || `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };

              // Check unique constraint for templates
              if (table === 'workflow_templates' && insertData.name) {
                const existing = mockData[table]?.find(
                  (t: any) => t.tenant_id === insertData.tenant_id && t.name === insertData.name
                );
                if (existing && !isUpsert) {
                  return resolve({ data: null, error: { code: '23505', message: 'Duplicate' }, count: null });
                }
              }

              if (isUpsert) {
                const existingIdx = mockData[table]?.findIndex(
                  (t: any) => t.agent_id === insertData.agent_id && t.template_id === insertData.template_id
                );
                if (existingIdx >= 0) {
                  mockData[table][existingIdx] = { ...mockData[table][existingIdx], ...insertData, updated_at: new Date().toISOString() };
                  items = [mockData[table][existingIdx]];
                } else {
                  mockData[table] = mockData[table] || [];
                  mockData[table].push(newItem);
                  items = [newItem];
                }
              } else {
                mockData[table] = mockData[table] || [];
                mockData[table].push(newItem);
                items = [newItem];
              }
            }
          }

          if (updateData) {
            // Apply update to matching items
            let updated: any[] = [];
            for (let i = 0; i < (mockData[table] || []).length; i++) {
              const item = mockData[table][i];
              let matches = true;
              for (const f of filters) {
                if (f.op === 'eq' && item[f.field] !== f.value) matches = false;
              }
              if (matches) {
                mockData[table][i] = { ...item, ...updateData, updated_at: new Date().toISOString() };
                updated.push(mockData[table][i]);
              }
            }
            items = updated;
          }

          if (isDelete) {
            const before = mockData[table]?.length || 0;
            mockData[table] = (mockData[table] || []).filter((item: any) => {
              for (const f of filters) {
                if (f.op === 'eq' && item[f.field] !== f.value) return true;
              }
              return false;
            });
            return resolve({ data: null, error: null, count: before - (mockData[table]?.length || 0) });
          }

          if (!insertData && !updateData) {
            // Apply filters to items for reads
            items = (mockData[table] || []).filter((item: any) => {
              for (const f of filters) {
                if (f.op === 'eq' && item[f.field] !== f.value) return false;
                if (f.op === 'in' && !f.value.includes(item[f.field])) return false;
              }
              return true;
            });
          }

          const total = items.length;

          if (orderField) {
            items.sort((a: any, b: any) => {
              const va = a[orderField!];
              const vb = b[orderField!];
              return orderAsc ? (va > vb ? 1 : -1) : (va > vb ? -1 : 1);
            });
          }

          items = items.slice(rangeStart, rangeEnd + 1);

          if (isSingle) {
            if (items.length === 0) {
              return resolve({ data: null, error: { code: 'PGRST116', message: 'Not found' }, count: null });
            }
            return resolve({ data: items[0], error: null, count: countMode ? total : null });
          }

          return resolve({ data: items, error: null, count: countMode ? total : null });
        },
      };

      return builder;
    }

    const supabase = {
      from: (table: string) => createQueryBuilder(table),
      rpc: vi.fn().mockResolvedValue({ data: 0, error: null }),
      _mockData: mockData,
    };

    return supabase as any;
  }

  let supabase: ReturnType<typeof createMockSupabase>;

  beforeEach(() => {
    supabase = createMockSupabase();
    vi.restoreAllMocks();
    // Mock global fetch for webhook/external calls
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"result":"ok"}'),
    }));
  });

  // Import the engine dynamically to avoid issues with mocking
  async function getEngine() {
    const { createWorkflowEngine } = await import('../../src/services/workflow-engine.js');
    return createWorkflowEngine(supabase);
  }

  describe('Template CRUD (Story 29.1)', () => {
    it('creates a template', async () => {
      const engine = await getEngine();
      const template = await engine.createTemplate('tenant-1', {
        name: 'Test Workflow',
        description: 'A test workflow',
        steps: [
          { type: 'approval', name: 'Manager Approval', config: { timeout_hours: 24 } },
          { type: 'action', name: 'Execute Payment', config: { action: 'execute_transfer' } },
        ],
      });

      expect(template.name).toBe('Test Workflow');
      expect(template.description).toBe('A test workflow');
      expect(template.triggerType).toBe('manual');
      expect(template.isActive).toBe(true);
      expect(template.version).toBe(1);
      expect(template.steps).toHaveLength(2);
      expect(template.steps[0].type).toBe('approval');
      expect(template.steps[1].type).toBe('action');
    });

    it('gets a template by id', async () => {
      const engine = await getEngine();
      const created = await engine.createTemplate('tenant-1', {
        name: 'Get Test',
        steps: [{ type: 'action', name: 'Step 1', config: {} }],
      });

      const fetched = await engine.getTemplate('tenant-1', created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.name).toBe('Get Test');
    });

    it('returns null for non-existent template', async () => {
      const engine = await getEngine();
      const result = await engine.getTemplate('tenant-1', 'nonexistent-id');
      expect(result).toBeNull();
    });

    it('lists templates', async () => {
      const engine = await getEngine();
      await engine.createTemplate('tenant-1', {
        name: 'Template A',
        steps: [{ type: 'action', name: 'Step', config: {} }],
      });
      await engine.createTemplate('tenant-1', {
        name: 'Template B',
        steps: [{ type: 'approval', name: 'Approval', config: {} }],
      });

      const result = await engine.listTemplates('tenant-1');
      expect(result.data.length).toBe(2);
      expect(result.total).toBe(2);
    });

    it('updates a template', async () => {
      const engine = await getEngine();
      const created = await engine.createTemplate('tenant-1', {
        name: 'Original Name',
        steps: [{ type: 'action', name: 'Step', config: {} }],
      });

      const updated = await engine.updateTemplate('tenant-1', created.id, {
        name: 'Updated Name',
        description: 'Updated description',
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.description).toBe('Updated description');
    });

    it('bumps version when steps are updated', async () => {
      const engine = await getEngine();
      const created = await engine.createTemplate('tenant-1', {
        name: 'Version Test',
        steps: [{ type: 'action', name: 'Step', config: {} }],
      });

      expect(created.version).toBe(1);

      const updated = await engine.updateTemplate('tenant-1', created.id, {
        steps: [
          { type: 'approval', name: 'New Step', config: {} },
          { type: 'action', name: 'Action', config: {} },
        ],
      });

      expect(updated.version).toBe(2);
    });

    it('deletes a template', async () => {
      const engine = await getEngine();
      const created = await engine.createTemplate('tenant-1', {
        name: 'Delete Me',
        steps: [{ type: 'action', name: 'Step', config: {} }],
      });

      await engine.deleteTemplate('tenant-1', created.id);

      const fetched = await engine.getTemplate('tenant-1', created.id);
      expect(fetched).toBeNull();
    });

    it('rejects duplicate template names', async () => {
      const engine = await getEngine();
      await engine.createTemplate('tenant-1', {
        name: 'Unique Name',
        steps: [{ type: 'action', name: 'Step', config: {} }],
      });

      await expect(
        engine.createTemplate('tenant-1', {
          name: 'Unique Name',
          steps: [{ type: 'action', name: 'Step', config: {} }],
        })
      ).rejects.toThrow('already exists');
    });
  });

  describe('Instance Creation & State Machine (Story 29.2)', () => {
    it('creates an instance and starts it', async () => {
      const engine = await getEngine();
      const template = await engine.createTemplate('tenant-1', {
        name: 'Simple Action',
        steps: [
          { type: 'action', name: 'Do Something', config: { action: 'test' } },
        ],
      });

      const instance = await engine.createInstance('tenant-1', {
        templateId: template.id,
        triggerData: { amount: 1000 },
      });

      // Action steps complete immediately, so the workflow should be completed
      expect(instance.status).toBe('completed');
      expect(instance.triggerData).toEqual({ amount: 1000 });
    });

    it('pauses on approval steps', async () => {
      const engine = await getEngine();
      const template = await engine.createTemplate('tenant-1', {
        name: 'Approval Workflow',
        steps: [
          { type: 'approval', name: 'Manager Approval', config: { timeout_hours: 24 } },
          { type: 'action', name: 'Execute', config: { action: 'execute_transfer' } },
        ],
      });

      const instance = await engine.createInstance('tenant-1', {
        templateId: template.id,
      });

      // Should be paused waiting for approval
      expect(instance.status).toBe('paused');
    });

    it('rejects creation with inactive template', async () => {
      const engine = await getEngine();
      const template = await engine.createTemplate('tenant-1', {
        name: 'Inactive Template',
        steps: [{ type: 'action', name: 'Step', config: {} }],
        isActive: false,
      });

      await expect(
        engine.createInstance('tenant-1', { templateId: template.id })
      ).rejects.toThrow('not active');
    });

    it('lists instances', async () => {
      const engine = await getEngine();
      const template = await engine.createTemplate('tenant-1', {
        name: 'List Test',
        steps: [{ type: 'action', name: 'Step', config: { action: 'test' } }],
      });

      await engine.createInstance('tenant-1', { templateId: template.id });
      await engine.createInstance('tenant-1', { templateId: template.id });

      const result = await engine.listInstances('tenant-1');
      expect(result.data.length).toBe(2);
    });

    it('gets instance with steps', async () => {
      const engine = await getEngine();
      const template = await engine.createTemplate('tenant-1', {
        name: 'Steps Test',
        steps: [
          { type: 'approval', name: 'Approval', config: {} },
          { type: 'action', name: 'Action', config: { action: 'test' } },
        ],
      });

      const instance = await engine.createInstance('tenant-1', { templateId: template.id });
      const result = await engine.getInstanceWithSteps('tenant-1', instance.id);

      expect(result).not.toBeNull();
      expect(result!.steps).toHaveLength(2);
      expect(result!.steps[0].stepType).toBe('approval');
      expect(result!.steps[0].status).toBe('waiting_approval');
      expect(result!.steps[1].stepType).toBe('action');
      expect(result!.steps[1].status).toBe('pending');
    });

    it('cancels an instance', async () => {
      const engine = await getEngine();
      const template = await engine.createTemplate('tenant-1', {
        name: 'Cancel Test',
        steps: [{ type: 'approval', name: 'Approval', config: {} }],
      });

      const instance = await engine.createInstance('tenant-1', { templateId: template.id });
      const cancelled = await engine.cancelInstance('tenant-1', instance.id);

      expect(cancelled.status).toBe('cancelled');
    });
  });

  describe('Approval Step (Story 29.3)', () => {
    it('approves a step and continues workflow', async () => {
      const engine = await getEngine();
      const template = await engine.createTemplate('tenant-1', {
        name: 'Approve Test',
        steps: [
          { type: 'approval', name: 'Approval', config: { timeout_hours: 24 } },
          { type: 'action', name: 'Execute', config: { action: 'test' } },
        ],
      });

      const instance = await engine.createInstance('tenant-1', { templateId: template.id });
      expect(instance.status).toBe('paused');

      const step = await engine.approveStep('tenant-1', instance.id, 0, {
        decision: 'approved',
        approvedBy: 'user-123',
        reason: 'Looks good',
      });

      expect(step.status).toBe('approved');
      expect(step.approvalDecision).toBe('approved');
      expect(step.approvalReason).toBe('Looks good');

      // Instance should be completed (action step auto-completes)
      const final = await engine.getInstance('tenant-1', instance.id);
      expect(final!.status).toBe('completed');
    });

    it('rejects a step and fails the workflow', async () => {
      const engine = await getEngine();
      const template = await engine.createTemplate('tenant-1', {
        name: 'Reject Test',
        steps: [
          { type: 'approval', name: 'Approval', config: {} },
          { type: 'action', name: 'Execute', config: { action: 'test' } },
        ],
      });

      const instance = await engine.createInstance('tenant-1', { templateId: template.id });

      const step = await engine.approveStep('tenant-1', instance.id, 0, {
        decision: 'rejected',
        approvedBy: 'user-123',
        reason: 'Not authorized',
      });

      expect(step.status).toBe('rejected');

      const final = await engine.getInstance('tenant-1', instance.id);
      expect(final!.status).toBe('failed');
    });
  });

  describe('Condition Step (Story 29.4)', () => {
    it('evaluates true condition and continues', async () => {
      const engine = await getEngine();
      const template = await engine.createTemplate('tenant-1', {
        name: 'Condition True',
        steps: [
          { type: 'condition', name: 'Check Amount', config: { expression: 'trigger.amount > 500', if_true: 'continue', if_false: 'continue' } },
          { type: 'action', name: 'Execute', config: { action: 'test' } },
        ],
      });

      const instance = await engine.createInstance('tenant-1', {
        templateId: template.id,
        triggerData: { amount: 1000 },
      });

      expect(instance.status).toBe('completed');
    });

    it('skips steps on condition', async () => {
      const engine = await getEngine();
      const template = await engine.createTemplate('tenant-1', {
        name: 'Condition Skip',
        steps: [
          { type: 'condition', name: 'Check', config: { expression: 'trigger.amount <= 1000', if_true: 'skip_to:2', if_false: 'continue' } },
          { type: 'approval', name: 'CFO Approval', config: {} },
          { type: 'action', name: 'Execute', config: { action: 'test' } },
        ],
      });

      const instance = await engine.createInstance('tenant-1', {
        templateId: template.id,
        triggerData: { amount: 500 },
      });

      // The condition is true (500 <= 1000), so it should skip to step 2 (action)
      // Action completes immediately, so workflow should be completed
      expect(instance.status).toBe('completed');
    });
  });

  describe('Action Step (Story 29.5)', () => {
    it('executes action step with interpolated params', async () => {
      const engine = await getEngine();

      // Seed accounts and a transfer record in the mock DB so execute_transfer can work
      const transferId = 'txn_abc';
      supabase._mockData.accounts = [
        { id: 'acc-1', tenant_id: 'tenant-1', name: 'Sender', balance_total: 10000, balance_available: 10000, balance_in_streams: 0, balance_buffer: 0 },
        { id: 'acc-2', tenant_id: 'tenant-1', name: 'Receiver', balance_total: 0, balance_available: 0, balance_in_streams: 0, balance_buffer: 0 },
      ];
      supabase._mockData.transfers = [{
        id: transferId,
        tenant_id: 'tenant-1',
        status: 'pending',
        type: 'internal',
        amount: '100',
        from_account_id: 'acc-1',
        to_account_id: 'acc-2',
        description: 'Test transfer',
        created_at: new Date().toISOString(),
      }];

      const template = await engine.createTemplate('tenant-1', {
        name: 'Action Test',
        steps: [
          {
            type: 'action',
            name: 'Execute Transfer',
            config: {
              action: 'execute_transfer',
              params: { transfer_id: '{{trigger.transfer_id}}' },
            },
          },
        ],
      });

      const instance = await engine.createInstance('tenant-1', {
        templateId: template.id,
        triggerData: { transfer_id: transferId },
      });

      expect(instance.status).toBe('completed');

      const result = await engine.getInstanceWithSteps('tenant-1', instance.id);
      expect(result!.steps[0].status).toBe('completed');
      expect(result!.steps[0].output).toBeDefined();
    });
  });

  describe('Notification Step (Story 29.6)', () => {
    it('sends webhook notification', async () => {
      const engine = await getEngine();
      const template = await engine.createTemplate('tenant-1', {
        name: 'Notification Test',
        steps: [
          {
            type: 'notification',
            name: 'Notify',
            config: {
              type: 'webhook',
              url: 'https://example.com/webhook',
              payload: { message: 'Transfer {{trigger.id}} completed' },
            },
          },
        ],
      });

      const instance = await engine.createInstance('tenant-1', {
        templateId: template.id,
        triggerData: { id: 'txn_123' },
      });

      expect(instance.status).toBe('completed');
      // Verify fetch was called (for webhook delivery)
      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('Wait Step (Story 29.7)', () => {
    it('pauses workflow for duration wait', async () => {
      const engine = await getEngine();
      const template = await engine.createTemplate('tenant-1', {
        name: 'Wait Test',
        steps: [
          { type: 'wait', name: 'Wait 1h', config: { wait_type: 'duration', duration_minutes: 60 } },
          { type: 'action', name: 'After Wait', config: { action: 'test' } },
        ],
      });

      const instance = await engine.createInstance('tenant-1', { templateId: template.id });
      expect(instance.status).toBe('paused');
    });
  });

  describe('Pending Approvals (Story 29.9)', () => {
    it('lists pending approval steps', async () => {
      const engine = await getEngine();
      const template = await engine.createTemplate('tenant-1', {
        name: 'Pending Test',
        steps: [{ type: 'approval', name: 'Approval', config: {} }],
      });

      await engine.createInstance('tenant-1', { templateId: template.id });

      const pending = await engine.getPendingApprovals('tenant-1');
      expect(pending.data.length).toBe(1);
      expect(pending.data[0].status).toBe('waiting_approval');
    });
  });

  describe('Agent Permissions (Story 29.12)', () => {
    it('sets and retrieves agent permissions', async () => {
      const engine = await getEngine();
      const template = await engine.createTemplate('tenant-1', {
        name: 'Agent Perm Test',
        steps: [{ type: 'action', name: 'Step', config: {} }],
      });

      const perm = await engine.setAgentPermission('tenant-1', 'agent-1', template.id, {
        canInitiate: true,
        canApprove: true,
        approvalConditions: { max_amount: 5000 },
      });

      expect(perm.canInitiate).toBe(true);
      expect(perm.canApprove).toBe(true);
      expect(perm.approvalConditions).toEqual({ max_amount: 5000 });

      const fetched = await engine.getAgentPermission('tenant-1', 'agent-1', template.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.canInitiate).toBe(true);
    });

    it('lists agent permissions', async () => {
      const engine = await getEngine();
      const t1 = await engine.createTemplate('tenant-1', {
        name: 'Agent List Test 1',
        steps: [{ type: 'action', name: 'Step', config: {} }],
      });
      const t2 = await engine.createTemplate('tenant-1', {
        name: 'Agent List Test 2',
        steps: [{ type: 'action', name: 'Step', config: {} }],
      });

      await engine.setAgentPermission('tenant-1', 'agent-1', t1.id, { canInitiate: true });
      await engine.setAgentPermission('tenant-1', 'agent-1', t2.id, { canApprove: true });

      const perms = await engine.listAgentPermissions('tenant-1', 'agent-1');
      expect(perms.length).toBe(2);
    });
  });

  describe('Timeout Processing (Story 29.8)', () => {
    it('processes timeouts via RPC', async () => {
      const engine = await getEngine();
      const result = await engine.processTimeouts();
      expect(result.expiredInstances).toBe(0);
      expect(result.expiredSteps).toBe(0);
    });
  });

  describe('Multi-step Workflow Integration', () => {
    it('runs a complete multi-step workflow', async () => {
      const engine = await getEngine();

      // Seed accounts and a transfer record for the action step
      const transferId = 'txn_big';
      supabase._mockData.accounts = [
        { id: 'acc-1', tenant_id: 'tenant-1', name: 'Sender', balance_total: 50000, balance_available: 50000, balance_in_streams: 0, balance_buffer: 0 },
        { id: 'acc-2', tenant_id: 'tenant-1', name: 'Receiver', balance_total: 0, balance_available: 0, balance_in_streams: 0, balance_buffer: 0 },
      ];
      supabase._mockData.transfers = [{
        id: transferId,
        tenant_id: 'tenant-1',
        status: 'pending',
        type: 'internal',
        amount: '5000',
        from_account_id: 'acc-1',
        to_account_id: 'acc-2',
        description: 'Big procurement transfer',
        created_at: new Date().toISOString(),
      }];

      const template = await engine.createTemplate('tenant-1', {
        name: 'Full Procurement Workflow',
        steps: [
          { type: 'condition', name: 'Check Amount', config: { expression: 'trigger.amount > 1000', if_true: 'continue', if_false: 'skip_to:2' } },
          { type: 'approval', name: 'Manager Approval', config: { timeout_hours: 24 } },
          { type: 'action', name: 'Execute Payment', config: { action: 'execute_transfer', params: { transfer_id: '{{trigger.transfer_id}}' } } },
          { type: 'notification', name: 'Notify', config: { type: 'internal', message: 'Payment {{trigger.transfer_id}} completed' } },
        ],
      });

      // High amount: needs approval
      const instance = await engine.createInstance('tenant-1', {
        templateId: template.id,
        triggerData: { amount: 5000, transfer_id: transferId },
      });

      // Condition passes (amount > 1000), workflow should be paused at approval
      expect(instance.status).toBe('paused');

      // Approve the step
      await engine.approveStep('tenant-1', instance.id, 1, {
        decision: 'approved',
        approvedBy: 'manager-1',
        reason: 'Within budget',
      });

      // Workflow should complete (action + notification auto-execute)
      const final = await engine.getInstance('tenant-1', instance.id);
      expect(final!.status).toBe('completed');
    });

    it('skips steps in low-amount workflow', async () => {
      const engine = await getEngine();
      const template = await engine.createTemplate('tenant-1', {
        name: 'Skip Workflow',
        steps: [
          { type: 'condition', name: 'Check', config: { expression: 'trigger.amount <= 1000', if_true: 'skip_to:2', if_false: 'continue' } },
          { type: 'approval', name: 'Approval', config: {} },
          { type: 'action', name: 'Execute', config: { action: 'test' } },
        ],
      });

      const instance = await engine.createInstance('tenant-1', {
        templateId: template.id,
        triggerData: { amount: 500 },
      });

      // Low amount: skip approval, go directly to action
      expect(instance.status).toBe('completed');
    });
  });
});
