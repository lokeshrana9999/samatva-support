# samatva-support: orientation for agents

A deployed support assistant built on samatva's restraint design: an independent demo of a mental-health support agent whose safety gates live in code. Start with `docs/spec.md` (product decisions), then `docs/design.md` (system and frontend design).

- Until `docs/spec.md` exists and Lokesh has approved it, do the spec interview only: no app code, no scaffolding, no dependency installs.
- samatva lives at `C:\Users\lokes\Documents\Projects\personal\samatva`. Read it as reference; never edit it from here.
- Lokesh's shell is Windows PowerShell 5.1: commands for him use `;`, never `&&`.
- Use synthetic data only. Therapist profiles are invented samples, and the catalogue links only to free public resources (allowlisted origins in `src/adapters/catalogue/json.ts`), never to a company or booking page, with summaries in our own words (`docs/spec.md`, decision 2). Conversations and eval cases stay synthetic. Never commit secrets, `.env` or real conversations.
