import { describe, expect, it } from 'vitest';
import { NAVIGATION_MODES, trainingGuidance } from './navigation';

describe('beginner navigation guidance', () => {
  it('keeps technical API identifiers separate from plain-language names', () => {
    expect(NAVIGATION_MODES.map(({ id, label }) => [id, label])).toEqual([
      ['astar', 'Shortest-path navigation'], ['q_only', 'AI-trained navigation'], ['hybrid', 'Combined navigation'],
    ]);
  });
  it('allows shortest-path navigation without a model or training', () => {
    expect(trainingGuidance('astar', null).needsTraining).toBe(false);
    expect(trainingGuidance('astar', { trained_destinations: 0 }).needsTraining).toBe(false);
  });
  it('explains fallback honestly for missing or untrained AI models', () => {
    for (const mode of ['q_only', 'hybrid']) {
      expect(trainingGuidance(mode, null).needsTraining).toBe(true);
      expect(trainingGuidance(mode, { trained_destinations: 0 }).message).toContain('falls back');
      expect(trainingGuidance(mode, { trained_destinations: 4 }).message).toContain('Missing or incompatible');
      expect(trainingGuidance(mode, { trained_destinations: 4 }).needsTraining).toBe(false);
    }
  });
});
