# ChainGuard Investigator Agent

## Overview

The Investigator Agent is a Mastra AI agent that acts as a secondary fraud detection layer for suspicious UPI transactions. It receives transactions flagged by the Analyst Agent (score > 40) and performs deep investigation to deliver a final verdict.

## Technical Architecture

### Agent Definition (`src/mastra/agents/investigatorAgent.ts`)

The agent is built on Mastra's `Agent` class with:

- **ID**: `investigator-agent`
- **Model**: Configured via `weatherAgent` (delegates to underlying LLM)
- **Memory**: Uses `Memory` for conversation context

### Tools

The agent uses two tools defined in `src/tools/tools.ts`:

| Tool | Purpose |
|------|---------|
| `analyzeThoughtTrace` | Retrieves the Analyst Agent's scoring breakdown and triggered rules for the transaction |
| `queryMuleRegistry` | Queries the mule registry database for the sender's transaction history, fraud flags, and behavioral patterns |

#### analyzeThoughtTrace

```typescript
input: { transaction_id: string }
output: {
  score: number
  triggered_rules: Array<{rule: string, detail: string, weight: number}>
}
```

Uses `requestContext` to verify transaction details match and retrieve analyst output.

#### queryMuleRegistry

```typescript
input: { upi_id: string }
output: {
  first_seen: string
  total_transactions: number
  flagged_count: number
  avg_amount: number
  max_amount: number
  unique_receivers_count: number
  is_blacklisted: boolean
  connected_flagged_accounts: number
}
```

#### Mock Data Generation

The tool uses `mockMuleRegistryData()` function to generate deterministic mock data based on the UPI ID:

```typescript
const mockMuleRegistryData = (upiId: string) => {
  const seed = Array.from(upiId).reduce((acc, char) => acc + char.charCodeAt(0), 0);

  const accountAgeDays = 2 + (seed % 12);
  const totalTransactions = 18 + (seed % 55);
  const flaggedCount = Math.max(2, Math.floor(totalTransactions * (0.1 + (seed % 7) / 100)));
  const avgAmount = 600 + (seed % 1800);
  const maxAmount = avgAmount * (14 + (seed % 24));
  const uniqueReceivers = 9 + (seed % 26);
  const connectedFlaggedAccounts = 2 + (seed % 6);
  const isBlacklisted = seed % 9 === 0 || flaggedCount >= 8 || connectedFlaggedAccounts >= 5;

  return { ... };
};
```

**How it works:**
- **Seed**: Sum of all character codes in the UPI ID string
- **Deterministic**: Same UPI ID always produces the same data (useful for testing)
- **Calculated fields**: Uses modulo operations to generate realistic-looking fraud indicators
- **Blacklist logic**: Account is blacklisted if `(seed % 9 === 0)` OR `flaggedCount >= 8` OR `connectedFlaggedAccounts >= 5`

This mock simulates real fraud patterns for demo/development without requiring actual database access.

### Input Schema (`investigatorInputSchema`)

```typescript
{
  transaction: {
    transaction_id: string
    sender_upi: string
    receiver_upi: string
    amount: number
    timestamp: string
  }
  analyst_output: {
    score: number
    triggered_rules: Array<{rule, detail, weight}>
  }
}
```

### Output Schema (`investigatorVerdictSchema`)

```typescript
{
  verdict: 'SAFE' | 'REVIEW' | 'BLOCK'
  confidence: number (0-1)
  reasoning: string
  tools_used: string[]
  evidence: {
    account_age_days: number
    prior_flags: number
    is_blacklisted: boolean
    connected_flagged_accounts: number
    amount_ratio: number
    analyst_score: number
    triggered_rules: string[]
  }
}
```

## Investigation Flow

1. **Receive Transaction**: Agent receives suspicious transaction with Analyst's scoring context
2. **Call `analyzeThoughtTrace`**: Retrieve what the Analyst Agent already found
3. **Call `queryMuleRegistry`**: Get sender's fraud history and behavioral patterns
4. **Reason**: Combine evidence from both tools to reach a conclusion
5. **Return Verdict**: Structured verdict with confidence score

## Verdict Logic

| Condition | Verdict |
|-----------|---------|
| Combined evidence weak or contradictory | SAFE |
| 1-2 moderate signals with no blacklist | REVIEW |
| 2+ strong signals OR blacklisted OR connected to flagged accounts | BLOCK |

## Usage

```typescript
import { runInvestigation } from './mastra/agents/investigatorAgent';

const verdict = await runInvestigation({
  transaction: { ... },
  analyst_output: { score: 65, triggered_rules: [...] }
});
```

## Report Generation

Use `formatInvestigationReport()` to generate a markdown report for the merchant dashboard:

```typescript
const report = formatInvestigationReport(input, verdict);
```

Returns formatted markdown with:
- Transaction details
- Verdict with confidence percentage
- Evidence summary
- Triggered rules
- Reasoning