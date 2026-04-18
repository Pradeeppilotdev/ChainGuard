import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';
import { weatherAgent } from '../mastra/agents/weather-agent';
import {
  analyzeThoughtTrace,
  investigatorInputSchema,
  queryMuleRegistry,
} from '../tools/tools';

export const investigatorVerdictSchema = z.object({
  verdict: z.enum(['SAFE', 'REVIEW', 'BLOCK']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  tools_used: z.array(z.string()),
  evidence: z.object({
    account_age_days: z.number(),
    prior_flags: z.number(),
    is_blacklisted: z.boolean(),
    connected_flagged_accounts: z.number(),
    amount_ratio: z.number(),
    analyst_score: z.number(),
    triggered_rules: z.array(z.string()),
  }),
});

export type InvestigatorInput = z.infer<typeof investigatorInputSchema>;
export type InvestigatorVerdict = z.infer<typeof investigatorVerdictSchema>;

export const investigatorAgent = new Agent({
  id: 'investigator-agent',
  name: 'Investigator Agent',
  instructions: `
You are a senior fraud investigator for ChainGuard, an AI middleware that protects
innocent UPI merchants from receiving tainted payments that could freeze their accounts.

You receive suspicious transactions that the Analyst Agent has already scored above 40.
Your job is to investigate deeply and deliver a final verdict.

INVESTIGATION PROCESS:
1. First call analyzeThoughtTrace to understand what the Analyst already found
2. Then call queryMuleRegistry with the sender's UPI ID to get their history
3. Reason across both results to reach a conclusion
4. Return a structured verdict

VERDICT OPTIONS:
- SAFE: Evidence does not support fraud. Allow payment to settle.
- REVIEW: Ambiguous signals. Hold payment and alert merchant dashboard.
- BLOCK: Strong fraud evidence. Block payment and trigger auto-refund.

VERDICT THRESHOLDS:
- Combined evidence weak or contradictory -> SAFE
- 1-2 moderate signals with no blacklist -> REVIEW
- 2+ strong signals OR blacklisted OR connected to flagged accounts -> BLOCK

ALWAYS ground your reasoning in specific evidence from your tool results.
Never make claims not supported by tool output.
Be concise but specific - your reasoning becomes the merchant's legitimacy report.
`,
  model: weatherAgent.model,
  tools: {
    analyzeThoughtTrace,
    queryMuleRegistry,
  },
  memory: new Memory(),
});

export const runInvestigation = async (
  input: InvestigatorInput,
): Promise<InvestigatorVerdict> => {
  const requestContext = new RequestContext<InvestigatorInput>();
  requestContext.set('transaction', input.transaction);
  requestContext.set('analyst_output', input.analyst_output);

  const prompt = `Investigate this suspicious UPI transaction and return a final verdict.\n\n${JSON.stringify(
    input,
    null,
    2,
  )}`;

  const result = await investigatorAgent.generate(
    [
      {
        role: 'user',
        content: prompt,
      },
    ],
    {
      requestContext,
      maxSteps: 5,
      structuredOutput: {
        schema: investigatorVerdictSchema,
      },
    },
  );

  return result.object;
};
