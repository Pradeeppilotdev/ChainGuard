import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const triggeredRuleSchema = z.object({
  rule: z.string(),
  detail: z.string(),
  weight: z.number(),
});

export const analystOutputSchema = z.object({
  score: z.number(),
  triggered_rules: z.array(triggeredRuleSchema),
});

export const transactionSchema = z.object({
  transaction_id: z.string(),
  sender_upi: z.string(),
  receiver_upi: z.string(),
  amount: z.number(),
  timestamp: z.string(),
});

export const investigatorInputSchema = z.object({
  transaction: transactionSchema,
  analyst_output: analystOutputSchema,
});

export const muleRegistrySchema = z.object({
  first_seen: z.string(),
  total_transactions: z.number(),
  flagged_count: z.number(),
  avg_amount: z.number(),
  max_amount: z.number(),
  unique_receivers_count: z.number(),
  is_blacklisted: z.boolean(),
  connected_flagged_accounts: z.number(),
});

const mockMuleRegistryData = (upiId: string) => {
  const seed = Array.from(upiId).reduce((acc, char) => acc + char.charCodeAt(0), 0);

  const accountAgeDays = 2 + (seed % 12);
  const now = new Date();
  const firstSeen = new Date(now.getTime() - accountAgeDays * 24 * 60 * 60 * 1000);

  const totalTransactions = 18 + (seed % 55);
  const flaggedCount = Math.max(2, Math.floor(totalTransactions * (0.1 + (seed % 7) / 100)));
  const avgAmount = 600 + (seed % 1800);
  const maxAmount = avgAmount * (14 + (seed % 24));
  const uniqueReceivers = 9 + (seed % 26);
  const connectedFlaggedAccounts = 2 + (seed % 6);
  const isBlacklisted = seed % 9 === 0 || flaggedCount >= 8 || connectedFlaggedAccounts >= 5;

  return {
    first_seen: firstSeen.toISOString(),
    total_transactions: totalTransactions,
    flagged_count: flaggedCount,
    avg_amount: avgAmount,
    max_amount: maxAmount,
    unique_receivers_count: uniqueReceivers,
    is_blacklisted: isBlacklisted,
    connected_flagged_accounts: connectedFlaggedAccounts,
  };
};

export const queryMuleRegistry = createTool({
  id: 'queryMuleRegistry',
  description:
    "Query the mule registry database for a sender's transaction history, fraud flags, and behavioral patterns",
  inputSchema: z.object({
    upi_id: z.string(),
  }),
  outputSchema: muleRegistrySchema,
  execute: async ({ upi_id }) => {
    return mockMuleRegistryData(upi_id);
  },
});

export const analyzeThoughtTrace = createTool({
  id: 'analyzeThoughtTrace',
  description:
    "Retrieve the Analyst Agent's scoring breakdown and triggered rules for this transaction",
  inputSchema: z.object({
    transaction_id: z.string(),
  }),
  outputSchema: analystOutputSchema,
  requestContextSchema: z.object({
    transaction: transactionSchema,
    analyst_output: analystOutputSchema,
  }),
  execute: async ({ transaction_id }, context) => {
    const transaction = context?.requestContext?.get('transaction') as
      | z.infer<typeof transactionSchema>
      | undefined;

    if (transaction && transaction.transaction_id !== transaction_id) {
      throw new Error('Transaction ID does not match request context');
    }

    const analystOutput = context?.requestContext?.get('analyst_output') as
      | z.infer<typeof analystOutputSchema>
      | undefined;

    if (!analystOutput) {
      throw new Error('Analyst output was not found in request context');
    }

    return analystOutput;
  },
});
