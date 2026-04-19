import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  transactionSchema,
  analystOutputSchema,
  triggeredRuleSchema,
} from '../../tools/tools';

const scoreTransaction = createTool({
  id: 'scoreTransaction',
  description: 'Score a UPI transaction against fraud detection rules and return a risk score with triggered rules',
  inputSchema: transactionSchema,
  outputSchema: analystOutputSchema,
  execute: async (transaction) => {
    const triggered: z.infer<typeof triggeredRuleSchema>[] = [];

    // Derive mock behavioral signals deterministically from UPI ID
    const seed = Array.from(transaction.sender_upi)
      .reduce((acc, c) => acc + c.charCodeAt(0), 0);

    const accountAgeDays = 2 + (seed % 12);
    const avgAmount = 600 + (seed % 1800);
    const recentTxCount = 3 + (seed % 10);
    const hour = new Date(transaction.timestamp).getHours();

    // Rule 1 — New account
    if (accountAgeDays < 30) {
      triggered.push({
        rule: 'NEW_ACCOUNT',
        detail: `Account is only ${accountAgeDays} days old`,
        weight: 25,
      });
    }

    // Rule 2 — High velocity
    if (recentTxCount > 5) {
      triggered.push({
        rule: 'HIGH_VELOCITY',
        detail: `${recentTxCount} transactions in the last 60 minutes`,
        weight: 30,
      });
    }

    // Rule 3 — Amount spike
    if (transaction.amount > avgAmount * 5) {
      triggered.push({
        rule: 'AMOUNT_SPIKE',
        detail: `₹${transaction.amount} is ${(transaction.amount / avgAmount).toFixed(1)}x the sender average of ₹${avgAmount}`,
        weight: 25,
      });
    }

    // Rule 4 — Odd hours
    if (hour >= 1 && hour <= 4) {
      triggered.push({
        rule: 'ODD_HOURS',
        detail: `Transaction initiated at ${hour}:00 AM`,
        weight: 10,
      });
    }

    // Rule 5 — First time receiver
    const receiverSeed = Array.from(transaction.receiver_upi)
      .reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const isFirstTime = (seed + receiverSeed) % 3 === 0;
    if (isFirstTime) {
      triggered.push({
        rule: 'FIRST_TIME_RECEIVER',
        detail: `Sender has never transacted with ${transaction.receiver_upi} before`,
        weight: 10,
      });
    }

    const score = Math.min(100, triggered.reduce((sum, r) => sum + r.weight, 0));

    return {
      score,
      triggered_rules: triggered,
    };
  },
});

export const analystAgent = new Agent({
  id: 'analyst-agent',
  name: 'Analyst Agent',
  instructions: `
You are the first-line fraud analyst for ChainGuard, an AI middleware that protects
innocent UPI merchants from tainted fund chains.

Your job is to score incoming UPI transactions using the scoreTransaction tool.

PROCESS:
1. Call scoreTransaction with the full transaction details
2. Return the score and triggered rules exactly as the tool returns them
3. Do not add commentary or modify the output
4. Return as a plain text JSON object matching the output schema

If score < 40: transaction is low risk
If score >= 40: transaction needs deep investigation by the Investigator Agent

Always call the tool. Never guess or fabricate scores.
`,
  model: 'groq/llama-3.3-70b-versatile',
  tools: { scoreTransaction },
});

export const runAnalysis = async (
  transaction: z.infer<typeof transactionSchema>,
): Promise<z.infer<typeof analystOutputSchema>> => {
  const result = await analystAgent.generate(
    [{ role: 'user', content: JSON.stringify(transaction) }],
    {
      maxSteps: 3,
      structuredOutput: { schema: analystOutputSchema },
    },
  );
  return result.object;
};