import { getStrategyNames, getStrategyPrompt, getStrategyDescription, getStaticFollowups } from './prompts';

export function createDefaultSequences(lang = 'en') {
  const followups = getStaticFollowups(lang);

  return getStrategyNames().map((name) => {
    const prompt = getStrategyPrompt(name, lang);
    const description = getStrategyDescription(name, lang);
    return {
      id: crypto.randomUUID(),
      name,
      description: description || name,
      messages: [
        { id: crypto.randomUUID(), label: 'Message 1', type: 'ai', delayDays: 1, prompt: prompt || '' },
        ...followups.map((m) => ({ ...m, id: crypto.randomUUID() })),
      ],
    };
  });
}

// Switch language on existing sequences: swap prompts for matching strategy names
export function switchSequenceLanguage(sequences, lang) {
  const followups = getStaticFollowups(lang);

  return sequences.map((seq) => {
    const newPrompt = getStrategyPrompt(seq.name, lang);
    const newDesc = getStrategyDescription(seq.name, lang);

    if (!newPrompt) return seq; // Not a known strategy, keep as-is

    const messages = seq.messages.map((msg, idx) => {
      if (idx === 0 && msg.type === 'ai') {
        return { ...msg, prompt: newPrompt };
      }
      // For static follow-ups (Message 2, 3), swap to matching language version
      const followupIdx = idx - 1;
      if (msg.type === 'static' && followups[followupIdx]) {
        return { ...msg, prompt: followups[followupIdx].prompt };
      }
      return msg;
    });

    return {
      ...seq,
      description: newDesc || seq.description,
      messages,
    };
  });
}
