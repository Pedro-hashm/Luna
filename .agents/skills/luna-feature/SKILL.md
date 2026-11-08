---
name: luna-feature
description: Research, plan, implement, evaluate and deliver a Luna feature through an isolated worktree and GitHub pull request. Use for feature requests and behavior changes in Luna.
---

# Deliver a Luna feature

1. Read the affected entry points and existing tests. Research primary sources for the specific behavior. Present the design choices, acceptance cases, tradeoffs and rollback before coding.
2. After the plan is agreed, branch from the current remote default in a separate worktree. Record and push each meaningful update before reporting it. Open a draft PR after the first push. Preserve checkpoints with ordinary commits.
3. Define feature cases and regression cases in the format described in [the evaluation guide](../../../docs/feature-workflow.md). Run quick tests during development and compare base and candidate with the same fixtures and model settings. Use the real provider when its behavior matters. Add the existing voice or research smoke tests when those paths change.
4. Inspect the answer and trace for each failing or ambiguous case. Use deterministic assertions for facts, tool calls and errors. For qualitative changes, review blind A/B examples against an agreed rubric and repeat unstable cases. Mark skipped or unavailable required checks incomplete.
5. In the PR, record the base and candidate SHAs, per-case results, relevant latency and tokens, limitations and rollback. Publish only synthetic excerpts or sanitized summaries. Check the current base and head again before merging. Revalidate after either changes. Squash merge after the agreed checks pass and authorization is in place.
