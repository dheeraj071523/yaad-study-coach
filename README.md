# Yaad — an offline study coach (QVAC SDK)

Yaad reads **your own notes**, asks you a question about them, scores your
answer, and brings your weak topics back more often. Everything runs
**on-device** with [Tether's QVAC SDK](https://github.com/tetherto/qvac):
no API key, no cloud call, your notes never leave your machine.

## How it works

| Step | QVAC function | What happens |
|------|---------------|--------------|
| 1 | `loadModel()` | Loads EmbeddingGemma 300M and Llama 3.2 1B (both Q4) |
| 2 | `completion()` | Local LLM turns one sentence of your notes into a question |
| 3 | `completion()` | Local LLM extracts the short answer *from that sentence* - accepted only if it literally appears in your notes |
| 4 | `embed()` | Your answer and the expected answer are embedded and compared (cosine) |
| 5 | code | Score = 70% keyword coverage + 30% semantic similarity; verdict is computed by code |

**Design note:** a 1B model is a poor judge (early versions let it grade answers and
it contradicted itself), so the LLM only *writes* questions and *extracts* answers,
while grading is deterministic and unit-tested (`npm test`).

Scores are stored in `progress.json`; the lowest-scoring facts are asked first.

## Tested with

- `@qvac/sdk` **^0.19.1** (>= 0.19.0 required)
- Node.js >= 22.17, npm >= 10.9
- Runs comfortably on an 8 GB RAM machine (about 1 GB for both models)

## Install

```bash
git clone https://github.com/YOUR_USERNAME/yaad-study-coach.git
cd yaad-study-coach
npm install
```

Everything installs locally into this folder (`node_modules/`). Models are
cached in `./models/` (see `qvac.config.js`), so nothing is installed globally.

## Run

```bash
npm start                 # English feedback
npm run start:hinglish    # Hinglish feedback
```

The first run downloads the models (roughly 1 GB); after that it works offline.
Put your own `.md` / `.txt` notes in `notes/` (a sample is included).

Commands while answering: `/skip`, `/stats`, `/quit`.

## Optional: check your system

```bash
npm run doctor
```

## License

MIT
