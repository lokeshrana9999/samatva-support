# samatva-support: orientation for agents

A deployed support assistant built on samatva's restraint design, made as Lokesh's build submission for Amaha's AI Engineer role. Start with `docs/spec.md` (product decisions), then `docs/design.md` (system and frontend design). `docs/handoff.md` is the superseded starting brief.

- Until `docs/spec.md` exists and Lokesh has approved it, do the spec interview only: no app code, no scaffolding, no dependency installs.
- samatva lives at `C:\Users\lokes\Documents\Projects\personal\samatva`. Read it as reference; never edit it from here.
- Lokesh's shell is Windows PowerShell 5.1: commands for him use `;`, never `&&`.
- Use synthetic data only, with one exception: the catalogue may hold public Amaha therapist and service profiles, hand-copied with source URL and date (`docs/spec.md`, decision 2a). Conversations and eval cases stay synthetic. Never commit secrets, `.env` or real conversations.
