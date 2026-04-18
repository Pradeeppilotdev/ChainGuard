import { runInvestigation, type InvestigatorInput } from './agents/investigatorAgent';

const testInput: InvestigatorInput = {
  transaction: {
    transaction_id: 'TXN_20260418_001',
    sender_upi: 'user123@ybl',
    receiver_upi: 'merchant456@razorpay',
    amount: 28000,
    timestamp: '2026-04-18T03:42:00Z',
  },
  analyst_output: {
    score: 67,
    triggered_rules: [
      {
        rule: 'account_age',
        detail: 'Account is 3 days old',
        weight: 30,
      },
      {
        rule: 'amount_spike',
        detail: 'INR 28,000 is 62x their historical average of INR 450',
        weight: 25,
      },
      {
        rule: 'velocity',
        detail: '7 transactions in the last hour',
        weight: 12,
      },
    ],
  },
};

const main = async () => {
  const verdict = await runInvestigation(testInput);
  console.log('Investigator verdict:');
  console.log(JSON.stringify(verdict, null, 2));
};

main().catch((error) => {
  console.error('Investigation run failed:', error);
  process.exit(1);
});
