import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { analystAgent } from '../agents/analystAgent';
import { investigatorAgent, investigatorVerdictSchema, formatInvestigationReport } from '../agents/investigatorAgent';
import { transactionSchema, analystOutputSchema } from '../../tools/tools';
import { saveReport, updateUpiStatus } from '../../db/setup';
import { threadName } from 'node:worker_threads';
import { create } from 'node:domain';

const extractJsonObject = (text: string) => {
	const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fencedMatch?.[1]) {
		return fencedMatch[1].trim();
	}

	const firstBrace = text.indexOf('{');
	const lastBrace = text.lastIndexOf('}');
	if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
		return text.trim();
	}

	return text.slice(firstBrace, lastBrace + 1).trim();
};

const analystStep = createStep({
	id: 'analyst-step',
	inputSchema: transactionSchema,
	outputSchema: analystOutputSchema,
	execute: async ({ inputData, requestContext }) => {
		requestContext.set('transaction', inputData);

		const result = await analystAgent.generate(
			[
				{
					role: 'user',
					content: JSON.stringify(inputData),
				},
			],
			{
				requestContext,
				maxSteps: 3,
			},
		);

		const parsed = JSON.parse(extractJsonObject(result.text));
		requestContext.set('analyst_output', parsed);
		return parsed;
	},
});

const investigatorStep = createStep({
	id: 'investigator-step',
	inputSchema: analystOutputSchema,
	outputSchema: investigatorVerdictSchema,
	execute: async ({ inputData, requestContext }) => {
		const transaction = requestContext.get('transaction') as z.infer<typeof transactionSchema>;
		const analystOutput = inputData;

		const investigatorInput = {
			transaction,
			analyst_output: analystOutput,
		};

		const result = await investigatorAgent.generate(
			[
				{
					role: 'user',
					content: `Investigate this suspicious UPI transaction and return a final verdict.

Return ONLY a valid JSON object with this EXACT structure - do NOT add any extra fields:
{
  "verdict": "SAFE" | "REVIEW" | "BLOCK",  // Must be exactly one of these strings (uppercase)
  "confidence": number between 0 and 1,
  "reasoning": string explaining your decision,
  "tools_used": string[] of tool names you called,
  "evidence": {
    "account_age_days": number,
    "prior_flags": number,
    "is_blacklisted": boolean,
    "connected_flagged_accounts": number,
    "amount_ratio": number,
    "analyst_score": number,
    "triggered_rules": string[]
  }
}

IMPORTANT:
- verdict MUST be exactly "SAFE", "REVIEW", or "BLOCK" (uppercase, no quotes around the valid options)
- All evidence fields are REQUIRED and must be numbers/boolean/array (not undefined)
- Do NOT use any other field names
- Do NOT skip any fields

${JSON.stringify(
						investigatorInput,
						null,
						2,
					)}`,
				},
			],
			{
				requestContext,
				maxSteps: 5,
			},
		);

		const rawText = result.text;
		const parsed = JSON.parse(extractJsonObject(rawText));
		return investigatorVerdictSchema.parse(parsed);
	},
});

const skipInvestigatorStep = createStep({
	id: 'skip-investigator-step',
	inputSchema: analystOutputSchema,
	outputSchema: investigatorVerdictSchema,

	execute: async({inputData}) => {
		return {
			verdict: 'SAFE' as const,
			confidence: 1,
			reasoning: `Skipped — analyst score ${inputData.score} is below threshold (40).`,
			tools_used: [],
			evidence: {
				account_age_days: 0,
        		prior_flags: 0,
        		is_blacklisted: false,
        		connected_flagged_accounts: 0,
        		amount_ratio: 0,
        		analyst_score: inputData.score,
        		triggered_rules: [],
			},
		};
	},
});


const mergeBranchStep = createStep({
	id: 'merge-branch-step',
	inputSchema: z.object({
		'investigator-step': investigatorVerdictSchema.optional(),
		'skip-investigator-step': investigatorVerdictSchema.optional(),
	}),
	outputSchema: investigatorVerdictSchema,
	execute: async ({inputData}) => {
		const result = inputData['investigator-step'] ?? inputData['skip-investigator-step'];
		if(!result) throw new Error("No branch result found")
			return result;
	}

})


const dbStoreStep = createStep({
  id: 'db-store-step',
  inputSchema: investigatorVerdictSchema,
  outputSchema: z.object({ stored: z.boolean() }),
  execute: async ({ inputData, requestContext }) => {
    const transaction = requestContext.get('transaction') as z.infer<typeof transactionSchema>;
    const analystOutput = requestContext.get('analyst_output') as z.infer<typeof analystOutputSchema>;

    const reportId = crypto.randomUUID();
    const markdown = formatInvestigationReport(
      { transaction, analyst_output: analystOutput },
      inputData,
    );

    await saveReport({
      id: reportId,
      upiId: transaction.sender_upi,
      markdownResult: markdown,
    });

    const isBlocked = inputData.verdict === 'BLOCK';
    await updateUpiStatus(transaction.sender_upi, isBlocked);

    return { stored: true };
  },
});

const cgWorkflow = createWorkflow({
  id: 'cg-workflow',
  inputSchema: transactionSchema,
  outputSchema: investigatorVerdictSchema,
})
  .then(analystStep)
  .branch([
	[
		async ({inputData}) => inputData.score >= 40,
		investigatorStep
	],
	[
		async ({inputData}) => inputData.score < 40,
		skipInvestigatorStep,
	]
  ])
  .then(mergeBranchStep)
  .then(dbStoreStep)

cgWorkflow.commit();

export { cgWorkflow };

