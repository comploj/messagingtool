import {
  getEffectiveStrategyKeys,
  getEffectiveStrategy,
  getEffectiveStrategyDisplayName,
  getEffectiveStaticFollowups,
} from './promptOverrides';

export function createDefaultSequences(lang = 'en') {
  const followups = getEffectiveStaticFollowups(lang);

  return getEffectiveStrategyKeys().map((key) => {
    const eff = getEffectiveStrategy(key, lang);
    return {
      id: crypto.randomUUID(),
      strategyKey: key,
      name: eff.displayName || key,
      description: eff.description || key,
      messages: [
        { id: crypto.randomUUID(), label: 'Message 1', type: 'ai', delayDays: eff.delayDays || 1, prompt: eff.prompt || '' },
        ...followups.map((m) => ({ ...m, id: crypto.randomUUID() })),
      ],
    };
  });
}

// Switch language on existing sequences: swap prompts/descriptions for matching strategies.
// Preserves strategyKey-based matching so renames don't break it.
export function switchSequenceLanguage(sequences, lang) {
  const followups = getEffectiveStaticFollowups(lang);

  return sequences.map((seq) => {
    const key = seq.strategyKey || seq.name;
    const eff = getEffectiveStrategy(key, lang);
    if (!eff.prompt) return seq; // Not a known strategy, keep as-is

    const messages = seq.messages.map((msg, idx) => {
      if (idx === 0 && msg.type === 'ai') {
        return { ...msg, prompt: eff.prompt };
      }
      const followupIdx = idx - 1;
      if (msg.type === 'static' && followups[followupIdx]) {
        return { ...msg, prompt: followups[followupIdx].prompt };
      }
      return msg;
    });

    return {
      ...seq,
      description: eff.description || seq.description,
      messages,
    };
  });
}
