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

  // Seed only used for signals that genuinely need a stable mock baseline
  const seed = Array.from(transaction.sender_upi)
    .reduce((acc, c) => acc + c.charCodeAt(0), 0);

  // --- Signal 1: Account Age ---
  // Only flag if UPI ID looks newly created (short, numeric-heavy, random-looking)
  const hasNumericHeavyId = (transaction.sender_upi.match(/\d/g) || []).length >= 4;
  const accountAgeDays = 2 + (seed % 12);
  if (hasNumericHeavyId && accountAgeDays < 30) {
    triggered.push({
      rule: 'NEW_ACCOUNT',
      detail: `Account is only ${accountAgeDays} days old`,
      weight: 25,
    });
  }

  // --- Signal 2: Amount Spike ---
  // This should be the PRIMARY signal — actual amount vs baseline
  const avgAmount = 600 + (seed % 1800); // sender's typical spend
  const amountRatio = transaction.amount / avgAmount;
  if (amountRatio > 10) {
    triggered.push({
      rule: 'AMOUNT_SPIKE',
      detail: `₹${transaction.amount} is ${amountRatio.toFixed(1)}x the sender average of ₹${avgAmount}`,
      weight: 35,
    });
  } else if (amountRatio > 5) {
    triggered.push({
      rule: 'AMOUNT_SPIKE',
      detail: `₹${transaction.amount} is ${amountRatio.toFixed(1)}x the sender average of ₹${avgAmount}`,
      weight: 20,
    });
  }

  // --- Signal 3: High Velocity ---
  // Only flag for large amounts — small amounts rarely indicate mule activity
  const recentTxCount = 3 + (seed % 10);
  if (recentTxCount > 5 && transaction.amount > 5000) {
    triggered.push({
      rule: 'HIGH_VELOCITY',
      detail: `${recentTxCount} transactions in the last 60 minutes`,
      weight: 30,
    });
  }

  // --- Signal 4: Odd Hours ---
  // Real signal — uses actual timestamp
  const hour = new Date(transaction.timestamp).getHours();
  if (hour >= 1 && hour <= 4) {
    triggered.push({
      rule: 'ODD_HOURS',
      detail: `Transaction initiated at ${hour}:00 AM`,
      weight: 10,
    });
  }

  // --- Signal 5: First Time Receiver ---
  // Only meaningful for larger amounts
  const receiverSeed = Array.from(transaction.receiver_upi)
    .reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const isFirstTime = (seed + receiverSeed) % 3 === 0;
  if (isFirstTime && transaction.amount > 2000) {
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