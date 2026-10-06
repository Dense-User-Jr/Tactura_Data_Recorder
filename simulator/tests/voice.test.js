import { describe, expect, it } from 'vitest';
import { rankSystemVoices } from '../src/voice/webSpeech.js';
import { createProgressTracker } from '../src/voice/progress.js';

const v = (name, lang) => ({ name, lang });

describe('rankSystemVoices (spec §9.2)', () => {
  it('prefers Natural / Neural / Premium / Enhanced / Siri / Google voices, then en-US, then other English', () => {
    const ranked = rankSystemVoices([
      v('Microsoft David', 'en-US'),
      v('Daniel', 'en-GB'),
      v('Microsoft Aria Online (Natural)', 'en-US'),
      v('Google UK English Female', 'en-GB'),
      v('Thomas', 'fr-FR'),
    ]).map((x) => x.name);
    expect(ranked).toEqual(['Microsoft Aria Online (Natural)', 'Google UK English Female', 'Microsoft David', 'Daniel']);
  });

  it('never picks a non-English voice, even a premium one', () => {
    expect(rankSystemVoices([v('Amélie (Enhanced)', 'fr-CA'), v('Fred', 'en-US')])[0].name).toBe('Fred');
    expect(rankSystemVoices([v('Anna (Premium)', 'de-DE')])).toEqual([]);
  });

  it('accepts underscore locales some platforms report', () => {
    expect(rankSystemVoices([v('Samantha', 'en_US')])).toHaveLength(1);
  });
});

describe('download progress', () => {
  it('combines files by bytes and never claims 100% before everything is done', () => {
    const p = createProgressTracker();
    p.update({ status: 'progress', file: 'config.json', loaded: 1, total: 1 });
    expect(p.value).toBeLessThan(1);
    p.update({ status: 'progress', file: 'onnx/model.onnx', loaded: 25, total: 100 });
    expect(p.value).toBeCloseTo(26 / 101, 3);
    p.update({ status: 'done', file: 'onnx/model.onnx' });
    expect(p.value).toBe(0.99);
  });

  it('ignores events without byte counts', () => {
    const p = createProgressTracker();
    expect(p.update({ status: 'initiate', file: 'x' })).toBe(0);
  });
});
