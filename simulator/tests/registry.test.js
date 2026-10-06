import { describe, expect, it, vi } from 'vitest';
import { StageSocket, loadStage } from '../src/pipeline/registry.js';
import { STAGES, stagesWith } from '../src/pipeline/Pipeline.js';

const standIn = () => ({ name: 'stand-in', run: () => 'from stand-in' });

describe('loadStage (spec §8.3)', () => {
  it('runs the stand-in, honestly labeled, when no project is configured', async () => {
    const { impl, status } = await loadStage('decoder', { standIn, project: null });
    expect(impl.name).toBe('stand-in');
    expect(status).toEqual({ mode: 'stand-in', name: 'decoder', reason: 'no project implementation configured' });
  });

  it('runs the project implementation when it loads', async () => {
    const { impl, status } = await loadStage('decoder', { standIn, project: async () => ({ name: 'real' }) });
    expect(impl.name).toBe('real');
    expect(status.mode).toBe('project');
  });

  it('falls back, notifies and reports an error when the project fails to load', async () => {
    const notify = vi.fn();
    const { impl, status } = await loadStage(
      'decoder',
      { standIn, project: async () => Promise.reject(new Error('Failed to fetch dynamically imported module')) },
      { notify },
    );
    expect(impl.name).toBe('stand-in');
    expect(status.mode).toBe('error');
    expect(status.reason).toMatch(/failed to load: Failed to fetch/);
    expect(notify).toHaveBeenCalledOnce();
  });

  it('?break=classifier: the v1 random-forest stub fails init and the passthrough takes over', async () => {
    const { impl, status } = await loadStage('classifier', stagesWith('classifier').classifier, { notify: () => {} });
    expect(impl.name).toMatch(/passthrough/);
    expect(status.mode).toBe('error');
    expect(status.reason).toMatch(/stub in v1/);
  });

  it('?break=decoder: a project pointing at a missing file falls back', async () => {
    const { status } = await loadStage('decoder', stagesWith('decoder').decoder, { context: { lexicon: null }, notify: () => {} });
    expect(status.mode).toBe('error');
  });

  it('ships with no project stages configured (v1)', () => {
    expect(STAGES.classifier.project).toBeNull();
    expect(STAGES.decoder.project).toBeNull();
    expect(stagesWith(null)).toBe(STAGES);
  });
});

describe('StageSocket (per-event fallback)', () => {
  it('uses the stand-in for a call the project throws on, and flips to error', async () => {
    const notify = vi.fn();
    const onStatus = vi.fn();
    const socket = new StageSocket(
      { impl: { run: () => { throw new Error('boom'); } }, standIn: standIn(), status: { mode: 'project', name: 'classifier' } },
      { notify, onStatus },
    );
    expect(await socket.call('run')).toBe('from stand-in');
    expect(socket.status.mode).toBe('error');
    expect(socket.status.reason).toMatch(/threw on run\(\): boom/);
    expect(notify).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenLastCalledWith(socket.status);
  });

  it('passes calls straight to the project implementation when it works', async () => {
    const socket = new StageSocket({ impl: { run: async () => 'real' }, standIn: standIn(), status: { mode: 'project', name: 'x' } });
    expect(await socket.call('run')).toBe('real');
    expect(socket.status.mode).toBe('project');
  });
});
