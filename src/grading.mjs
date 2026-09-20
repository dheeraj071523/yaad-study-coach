// Pure helper functions (no SDK import) so they can be unit-tested with `npm test`.

const STOP = new Set(
  "a an the is are was were be been of in on at to for and or but with by from as that this it its into than then so".split(" ")
);

export function splitSentences(text) {
  const out = [];
  for (const line of text.split(/\n+/)) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    for (const s of l.split(/(?<=[.!?])\s+/)) {
      const t = s.trim();
      if (t.length >= 40 && t.length <= 300) out.push(t);
    }
  }
  return out;
}

export function normalize(s) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

// light stemming: "moons" -> "moon"
const stem = (w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);

export function contentTokens(s) {
  return normalize(s)
    .split(" ")
    .filter((w) => w && !STOP.has(w))
    .map(stem);
}

// The LLM's extracted "expected answer" must literally appear in the source
// sentence, otherwise we do not trust it (small models can hallucinate).
export function isGrounded(expected, sentence) {
  const e = normalize(expected);
  return e.length > 0 && normalize(sentence).includes(e);
}

// Share of the expected answer's key words that the student's answer contains.
export function keywordCoverage(expected, answer) {
  const need = contentTokens(expected);
  if (!need.length) return null;
  const have = new Set(contentTokens(answer));
  return need.filter((w) => have.has(w)).length / need.length;
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Grounded short answer:  70% keyword coverage + 30% semantic similarity.
// Fallback (compare with a whole sentence): semantic only, rescaled.
export function scoreAnswer({ kw, cos, grounded }) {
  if (grounded && kw !== null) {
    const sem = clamp01((cos - 0.4) / 0.5);
    return Math.round(100 * (0.7 * kw + 0.3 * sem));
  }
  return Math.round(100 * clamp01((cos - 0.3) / 0.45));
}

export function verdict(score) {
  if (score >= 60) return "correct";
  if (score >= 30) return "partly";
  return "wrong";
}
