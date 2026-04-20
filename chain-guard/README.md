# ChainGuard

## Overview

ChainGuard is a fraud detection middleware for UPI transactions. It uses a two-agent pipeline:
1. **Analyst Agent** - scores transactions against fraud rules
2. **Investigator Agent** - performs deep investigation for high-risk transactions

Results are stored in a local SQLite database for reporting and lookup.

## Architecture

### Agents

| Agent | File | Purpose |
|-------|------|---------|
| `analyst-agent` | `src/mastra/agents/analystAgent.ts` | First-line fraud scoring |
| `investigator-agent` | `src/mastra/agents/investigatorAgent.ts` | Deep investigation |

### Workflow

The `cg-workflow` (`src/mastra/workflows/cgworkflow.ts`) uses branching and merging:

```
transaction → analystStep → branch → mergeBranchStep → dbStoreStep
                            ↓
                 ┌───────────┴───────────┐
                 ↓                       ↓
        investigatorStep          skipInvestigatorStep
                 ↓                       ↓
                 └───────────┬───────────┘
                             ↓
                       mergeBranchStep
```

1. **analystStep** - Calls `analystAgent` to score transaction
2. **Branch** - If score >= 40, calls `investigatorStep`; if score < 40, calls `skipInvestigatorStep` (skips deep investigation)
3. **mergeBranchStep** - Merges output from both branches into standard schema
4. **dbStoreStep** - Saves report + UPI status to database

#### Threshold Logic

Transactions with `score < 40` are automatically marked as **SAFE** without deep investigation. This optimizes for low-risk transactions.

### Database

Uses LibSQL (`@mastra/libsql`) with two files:

| File | Tables | Purpose |
|------|--------|---------|
| `mastra.db` | Mastra internal | Workflow state, memory |
| `reports.db` | `reports`, `upi_status` | Investigation results |

#### reports table

```sql
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  upi_id TEXT NOT NULL,
  markdown_result TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
)
```

#### upi_status table

```sql
CREATE TABLE upi_status (
  upi_id TEXT UNIQUE NOT NULL,
  is_blocked INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
)
```

## Schemas

### transactionSchema

```typescript
{
  transaction_id: string
  sender_upi: string
  receiver_upi: string
  amount: number
  timestamp: string
}
```

### analystOutputSchema

```typescript
{
  score: number
  triggered_rules: Array<{
    rule: string
    detail: string
    weight: number
  }>
}
```

### investigatorVerdictSchema

```typescript
{
  verdict: 'SAFE' | 'REVIEW' | 'BLOCK'
  confidence: number
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

## Tools

### scoreTransaction (`analystAgent`)

Scoring rules in `src/mastra/agents/analystAgent.ts`:

| Rule | Condition | Weight |
|------|-----------|--------|
| NEW_ACCOUNT | Account < 30 days | 25 |
| HIGH_VELOCITY | > 5 txns in 60 min | 30 |
| AMOUNT_SPIKE | Amount > 5x average | 25 |
| ODD_HOURS | 1-4 AM | 10 |
| FIRST_TIME_RECEIVER | Never transacted with receiver | 10 |

### analyzeThoughtTrace, queryMuleRegistry (`investigatorAgent`)

Defined in `src/tools/tools.ts`.

`queryMuleRegistry` uses deterministic mock data based on UPI ID.

## Usage

Start Mastra Studio:

```bash
npm run dev
```

Call workflow directly:

```typescript
import { mastra } from './mastra';
import { z } from 'zod';

const workflow = mastra.workflows.cgWorkflow;
const result = await workflow.run({
  input: {
    transaction_id: 'txn_123',
    sender_upi: 'user@ybl',
    receiver_upi: 'merchant@okicici',
    amount: 5000,
    timestamp: new Date().toISOString()
  }
});
```

## Report Generation

Use `formatInvestigationReport()` to generate markdown:

```typescript
import { formatInvestigationReport } from './mastra/agents/investigatorAgent';

const report = formatInvestigationReport(input, verdict);
```

## Database Helpers

In `src/db/setup.ts`:

```typescript
import { saveReport, updateUpiStatus, getReport, getUpiStatus } from './db/setup';

// Save investigation result
await saveReport({ id, upiId, markdownResult });

// Update blocked status
await updateUpiStatus('user@ybl', true); // true = blocked, false = not blocked

// Query
await getReport(id);
await getUpiStatus('user@ybl'); // returns boolean or null
```