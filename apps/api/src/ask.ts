import { v7 as uuidv7 } from 'uuid';
import type { Answer, AnswerClaim, Work } from '@vani/shared';
import { config } from './config.js';

const firstSentence = (text: string) => text.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || text.slice(0, 320);

export async function answerQuestion(question: string, works: Work[], notes: Array<{ title: string; markdown: string }>): Promise<Answer> {
  const usable = works.filter((work) => work.abstract.trim());
  if (!usable.length) return { id: uuidv7(), status: 'insufficient_evidence', markdown: 'There is not enough full-text or abstract evidence in this scope to answer reliably.',
    claims: [], limitations: ['Add PDFs or abstracts for the selected papers, then ask again.'], modelProvenance: { provider: 'none', validation: 'evidence_required' }, createdAt: new Date().toISOString() };

  if (config.openAiKey) {
    const evidence = usable.slice(0, 12).map((work, index) => `[P${index + 1}] ${work.title}\n${work.abstract.slice(0, 1800)}`).join('\n\n');
    const response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${config.openAiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.openAiModel, temperature: 0.1, response_format: { type: 'json_object' }, messages: [
        { role: 'system', content: 'Answer only from supplied evidence. Return JSON {claims:[{text,sources:[1]}],limitations:[]}. Separate author limitations from your inference. Never invent a source.' },
        { role: 'user', content: `Question: ${question}\n\nEvidence:\n${evidence}` }
      ] }), signal: AbortSignal.timeout(30_000) });
    if (response.ok) {
      const raw: any = await response.json();
      const parsed = JSON.parse(raw.choices?.[0]?.message?.content ?? '{}');
      const claims: AnswerClaim[] = (parsed.claims ?? []).flatMap((claim: any) => {
        const sourceNumbers = (claim.sources ?? []).filter((n: number) => usable[n - 1]);
        if (!sourceNumbers.length) return [];
        return [{ id: uuidv7(), text: String(claim.text), supportStatus: 'directly_supported' as const,
          evidence: sourceNumbers.map((n: number) => ({ type: 'paper_abstract', sourceId: usable[n - 1]!.id, label: usable[n - 1]!.citationKey, exactText: usable[n - 1]!.abstract })) }];
      });
      if (claims.length) return { id: uuidv7(), status: 'complete', markdown: claims.map((claim, i) => `${claim.text} [${i + 1}]`).join('\n\n'), claims,
        limitations: parsed.limitations ?? [], modelProvenance: { provider: 'openai', model: config.openAiModel, validation: 'claims_without_sources_removed' }, createdAt: new Date().toISOString() };
    }
  }

  const comparison = /\b(compare|difference|innovation|over|versus|vs\.?|shortcoming|limitation)\b/i.test(question);
  const selected = usable.slice(0, comparison ? 4 : 6);
  const claims = selected.map((work): AnswerClaim => ({ id: uuidv7(), text: `${work.title}: ${firstSentence(work.abstract)}`,
    supportStatus: 'directly_supported', evidence: [{ type: 'paper_abstract', sourceId: work.id, label: work.citationKey, exactText: work.abstract }] }));
  const noteClaim = notes[0]?.markdown ? { id: uuidv7(), text: `Your note “${notes[0].title}” adds: ${firstSentence(notes[0].markdown)}`,
    supportStatus: 'directly_supported' as const, evidence: [{ type: 'user_note', sourceId: 'note', label: notes[0].title, exactText: notes[0].markdown }] } : null;
  if (noteClaim) claims.push(noteClaim);
  return { id: uuidv7(), status: 'complete', markdown: claims.map((claim, index) => `${claim.text} [${index + 1}]`).join('\n\n'), claims,
    limitations: ['This local fallback summarizes stored abstracts; configure an LLM provider for structured cross-paper synthesis.', 'Claims are limited to evidence currently stored in VANI.'],
    modelProvenance: { provider: 'deterministic-local', model: 'extractive-v1', validation: 'direct evidence only' }, createdAt: new Date().toISOString() };
}
