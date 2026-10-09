# GAP-49: Meal-prep mode — clarification questions

This doc collects decisions needed to implement GAP-49 (Meal-prep mode: cook-to-batch and reuse prepped meals).

See BACKLOG.md excerpt and REQUIREMENTS.md for context. Before implementing the model, server actions, UI and tests, please confirm the following design choices so the implementation matches product intent.

1) PreparedBatch model ownership and tenancy
   - Should PreparedBatch be owned by a household (preferred) or by a single member? Proposal: PreparedBatch.householdId, cookedByMemberId optional.

2) Expiry date behavior
   - Should expiryDate be optional? Proposal: optional ISO date; if present, batches with expiryDate in the past are shown as expired and cannot be assigned.

3) Portion counting and fractional portions
   - Are portions integer counts only? Proposal: integer portions (totalPortions, remainingPortions) to keep UX simple.

4) Assigning portions to MealPlanEntry
   - Applying a prepared portion to a meal-plan entry should: (a) decrement remainingPortions immediately, and (b) attach a reference on MealPlanEntry (preparedBatchId + portionIndex or quantity). Proposal: store preparedBatchId and preparedPortionsUsed (int) on MealPlanEntry. If user unassigns/deletes the entry before it is consumed, portions are returned.

5) When a MealPlanEntry is marked eaten
   - Should marking as eaten also decrement inventory per ingredient by default or be opt-in per household? Proposal: add household setting `mealPrep.decrementInventoryOnConsume` (default false). If enabled, consuming an assigned prepared portion will additionally reduce inventory per recipe ingredient (scaled by portions used).

6) UI flows and UX details
   - "Mark cooked (batch)" flow: after creating a batch, show a distribution picker that either: (a) lets the user immediately attach N portions to planned meals for the current week, or (b) let user skip and attach later from the batch card. Proposal: support both; initial implementation can only support attaching later via a picker in the meal-entry dialog to keep scope manageable.

7) Dashboard card behaviour
   - The dashboard should list active batches (remainingPortions > 0), show cookedAt, cookedByMemberName, and quick actions: "Assign portions" and "Use one now". Confirm fields and actions.

8) Data model specifics
   - Proposed Prisma additions:
     model PreparedBatch {
       id String @id @default(cuid())
       householdId String
       recipeId String
       cookedByMemberId String?
       totalPortions Int
       remainingPortions Int
       cookedAt DateTime @default(now())
       expiryDate DateTime?
       createdAt DateTime @default(now())
     }

   - MealPlanEntry additions:
     preparedBatchId String?
     preparedPortionsUsed Int? @default(0)

   Confirm these fields or propose changes.

9) Acceptance tests & e2e scope
   - The backlog requests: create a prepared batch, assign portions to planner days, see remaining count update when portions are used or unassigned; unit tests for decrement/return logic; e2e that cooks a batch, assigns portions and consumes one on desktop and mobile.
   - Confirm priority: do we require full UI for distribution picker in this PR or is attaching from the meal-entry dialog acceptable for the e2e flow?

If any of the above differs from the product intent, please reply in the PR with the chosen option. After these are resolved I'll implement the model, actions, tests and e2e flows in a code PR.

— autopilot sub-agent
