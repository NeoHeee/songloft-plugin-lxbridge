import { describe, expect, it } from 'vitest';
import { summarizeDiagnosticChecks, type DiagnosticCheck } from '../../src/handlers/diagnostics';

function diagnostic(status: DiagnosticCheck['status']): DiagnosticCheck {
  return { id: status, category: 'core', title: status, status, summary: status, duration_ms: 1 };
}

describe('diagnostic summary', () => {
  it('reports fail as the highest priority state', () => {
    expect(summarizeDiagnosticChecks([diagnostic('pass'), diagnostic('warn'), diagnostic('fail')])).toEqual({
      overall: 'fail',
      counts: { pass: 1, warn: 1, fail: 1, info: 0 },
    });
  });

  it('reports warnings when there are no failures', () => {
    expect(summarizeDiagnosticChecks([diagnostic('pass'), diagnostic('warn'), diagnostic('info')]).overall).toBe('warn');
  });

  it('does not treat optional disabled integrations as a warning', () => {
    expect(summarizeDiagnosticChecks([diagnostic('pass'), diagnostic('info')]).overall).toBe('pass');
  });
});
