function toolNode(id, toolName, options) {
  return {
    kind: 'tool',
    id,
    toolName,
    input: options?.input,
    retry: options?.retry,
    timeoutMs: options?.timeoutMs,
  };
}
function sequenceNode(id, steps) {
  return { kind: 'sequence', id, steps };
}
function parallelNode(id, steps, maxConcurrency, failFast) {
  return { kind: 'parallel', id, steps, maxConcurrency, failFast };
}

const workflowId = 'workflow.replay-lab.v1';

const replayLabWorkflow = {
  kind: 'workflow-contract',
  version: 1,
  id: workflowId,
  displayName: 'Replay Lab',
  description:
    'Captures a target request, extracts its full context (headers, cookies, auth tokens, body), replays it with modifications, compares responses, and produces a replay script — enabling parameter tampering, signature validation, and API probing.',
  tags: ['reverse', 'replay', 'request', 'api', 'tamper', 'probe', 'mission'],
  timeoutMs: 8 * 60_000,
  defaultMaxConcurrency: 3,

  build(ctx) {
    const prefix = 'workflows.replayLab';
    const url = String(ctx.getConfig(`${prefix}.url`, 'https://example.com'));
    const waitUntil = String(ctx.getConfig(`${prefix}.waitUntil`, 'networkidle0'));
    const requestTail = Number(ctx.getConfig(`${prefix}.requestTail`, 30));
    const targetUrlPattern = String(ctx.getConfig(`${prefix}.targetUrlPattern`, ''));
    const replayCount = Number(ctx.getConfig(`${prefix}.replayCount`, 1));
    const maxConcurrency = Number(ctx.getConfig(`${prefix}.parallel.maxConcurrency`, 3));
    const exportHar = Boolean(ctx.getConfig(`${prefix}.exportHar`, true));

    const steps = [
      // Phase 1: Network Setup & Navigate
      toolNode('enable-network', 'network_enable', { input: { enableExceptions: true } }),
      toolNode('navigate', 'page_navigate', { input: { url, waitUntil } }),

      // Phase 2: Capture Traffic
      toolNode('capture-requests', 'network_get_requests', { input: { tail: requestTail } }),

      // Phase 3: Parallel Context Collection
      parallelNode(
        'collect-context',
        [
          toolNode('get-cookies', 'page_get_cookies'),
          toolNode('get-local-storage', 'page_get_local_storage'),
          toolNode('extract-auth', 'network_extract_auth', { input: { minConfidence: 0.2 } }),
          toolNode('get-network-stats', 'network_get_stats', { input: {} }),
        ],
        maxConcurrency,
        false,
      ),

      // Phase 4: Replay Target Request
      toolNode('replay-request', 'network_replay_request', {
        input: { urlPattern: targetUrlPattern, count: replayCount },
      }),

      // Phase 5: Instrumentation-level replay
      toolNode('instrumentation-replay', 'instrumentation_network_replay', {
        input: {},
      }),
    ];

    // Phase 6: HAR Export (Optional)
    if (exportHar) {
      steps.push(toolNode('export-har', 'network_export_har', { input: {} }));
    }

    // Phase 7: XHR/Fetch interceptor for live capture
    steps.push(
      toolNode('inject-fetch-interceptor', 'console_inject_fetch_interceptor', {
        input: { persistent: false },
      }),
    );

    // Phase 8: Evidence Recording
    steps.push(
      toolNode('create-evidence-session', 'instrumentation_session_create', {
        input: {
          name: `replay-lab-${new Date().toISOString().slice(0, 10)}`,
          metadata: { url, workflowId, targetUrlPattern },
        },
      }),
      toolNode('record-artifact', 'instrumentation_artifact_record', {
        input: {
          type: 'replay_session',
          label: `Replay lab for ${url}`,
          metadata: { url, targetUrlPattern, replayCount },
        },
      }),

      // Phase 9: Session Insight
      toolNode('emit-insight', 'append_session_insight', {
        input: {
          insight: JSON.stringify({
            status: 'replay_lab_complete',
            workflowId,
            url,
            targetUrlPattern,
            replayCount,
          }),
        },
      }),
    );

    return sequenceNode('replay-lab-root', steps);
  },

  onStart(ctx) {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', { workflowId, mission: 'replay_lab', stage: 'start' });
  },
  onFinish(ctx) {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', { workflowId, mission: 'replay_lab', stage: 'finish' });
  },
  onError(ctx, error) {
    ctx.emitMetric('workflow_errors_total', 1, 'counter', { workflowId, mission: 'replay_lab', stage: 'error', error: error.name });
  },
};

export default replayLabWorkflow;
