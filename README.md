# ConsensusWiki

ConsensusWiki is a live wiki for contested topics. It shows established, contested, and single-source claims with citations, then maps topic entities into a graph.

Demo topic: AI industry news.

## Development

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:3000` or pass a port:

```bash
pnpm exec next dev -H 127.0.0.1 -p 3100
```

## Checks

```bash
pnpm test
pnpm lint
pnpm build
pnpm test:e2e
```

## Environment

Copy `.env.example` and provide real provider keys when using live HydraDB/NIM integrations. Without provider env vars, the app runs against deterministic demo fallback data.
