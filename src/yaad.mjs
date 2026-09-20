// Yaad - an offline study coach powered by the QVAC SDK.
//
// Flow (all on-device):
//   1. Read notes/*.md|txt and split them into sentences.
//   2. completion() -> local LLM turns ONE sentence into a question.
//   3. completion() -> local LLM extracts the short answer FROM that sentence.
//                      We only trust it if it literally appears in your notes.
//   4. You answer. embed() compares your answer with the expected answer;
//      together with keyword coverage this gives a score. The verdict is
//      computed by code, NOT by the small LLM (small models are bad judges).
//   5. Scores go to progress.json; weak sentences come back more often.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  loadModel,
  unloadModel,
  embed,
  completion,
  LLAMA_3_2_1B_INST_Q4_0,
  EMBEDDINGGEMMA_300M_Q4_0,
} from "@qvac/sdk";
import {
  splitSentences, isGrounded, keywordCoverage, cosine, scoreAnswer, verdict,
} from "./grading.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOTES_DIR = path.join(ROOT, "notes");
const PROGRESS_FILE = path.join(ROOT, "progress.json");

const argLang = process.argv.includes("--lang")
  ? process.argv[process.argv.indexOf("--lang") + 1]
  : undefined;
const LANG = (argLang || process.env.YAAD_LANG || "english").toLowerCase();

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

function loadItems() {
  if (!fs.existsSync(NOTES_DIR)) return [];
  const items = [];
  for (const file of fs.readdirSync(NOTES_DIR).filter((f) => /\.(md|txt)$/i.test(f))) {
    const raw = fs.readFileSync(path.join(NOTES_DIR, file), "utf8");
    for (const text of splitSentences(raw)) {
      const id = crypto.createHash("sha1").update(text).digest("hex").slice(0, 10);
      items.push({ id, file, text });
    }
  }
  return items.slice(0, 300);
}

function loadProgress() {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8")); } catch { return {}; }
}
const saveProgress = (p) => fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));

function pickNext(items, progress, lastId) {
  const pool = items.length > 1 ? items.filter((x) => x.id !== lastId) : items;
  return pool
    .map((it) => {
      const p = progress[it.id];
      return { it, w: (p ? 1 - p.avg / 100 : 1.2) + Math.random() * 0.3 }; // unseen, then weakest
    })
    .sort((a, b) => b.w - a.w)[0].it;
}

async function ask(llmId, prompt, { maxTokens = 60, show = false } = {}) {
  const run = completion({
    modelId: llmId,
    history: [{ role: "user", content: prompt }],
    stream: true,
    generationParams: { temp: 0.2, predict: maxTokens },
  });
  let out = "";
  for await (const token of run.tokenStream) {
    if (show) process.stdout.write(token);
    out += token;
  }
  if (show) process.stdout.write("\n");
  return out.trim();
}

function showStats(items, progress) {
  const rows = items
    .filter((it) => progress[it.id])
    .map((it) => ({ it, p: progress[it.id] }))
    .sort((a, b) => a.p.avg - b.p.avg);
  if (!rows.length) return console.log(c.dim("No answers yet.\n"));
  console.log(c.bold("\nYour weakest facts (lowest first):"));
  for (const { it, p } of rows.slice(0, 5)) {
    console.log(`  ${String(Math.round(p.avg)).padStart(3)}%  (${p.attempts}x)  ${it.text.slice(0, 70)}...`);
  }
  console.log();
}

async function main() {
  const items = loadItems();
  if (!items.length) {
    console.log(c.red("No usable notes. Put .md/.txt files with full sentences in notes/."));
    process.exit(1);
  }
  console.log(c.bold("\nYaad - offline study coach") + c.dim("  (QVAC on-device AI)"));
  console.log(c.dim(`${items.length} facts loaded - language: ${LANG}\n`));

  const bar = (label) => (p) => process.stderr.write(`\r${label}: ${p.percentage.toFixed(0)}%   `);
  let embedId, llmId;
  try {
    embedId = await loadModel({
      modelSrc: EMBEDDINGGEMMA_300M_Q4_0,
      modelType: "embeddings",
      onProgress: bar("Loading embedding model"),
    });
    process.stderr.write("\n");
    llmId = await loadModel({
      modelSrc: LLAMA_3_2_1B_INST_Q4_0,
      modelType: "llm",
      modelConfig: { ctx_size: 2048 },
      onProgress: bar("Loading language model "),
    });
    process.stderr.write("\n\n");
    console.log(c.dim("Commands: /skip  /stats  /quit\n"));

    const progress = loadProgress();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let lastId = null;

    while (true) {
      const it = pickNext(items, progress, lastId);
      lastId = it.id;

      console.log(c.cyan(c.bold("Question ")) + c.dim(`[${it.file}]`));
      const question = await ask(
        llmId,
        `Write ONE short quiz question whose answer is stated in the sentence below. Do not reveal the answer in the question. Output only the question.\n\nSentence: ${it.text}`,
        { maxTokens: 60, show: true }
      );

      // Expected answer: extracted from the sentence, then verified against it.
      const extracted = (
        await ask(
          llmId,
          `Sentence: ${it.text}\nQuestion: ${question}\n\nAnswer the question using only words from the sentence. Give the shortest possible answer (1 to 6 words). Output only the answer.`,
          { maxTokens: 24 }
        )
      ).replace(/^["'\s]+|["'.\s]+$/g, "");
      const grounded = isGrounded(extracted, it.text);
      const expected = grounded ? extracted : it.text;

      const answer = (await rl.question(c.yellow("\nYour answer > "))).trim();
      if (answer === "/quit") break;
      if (answer === "/stats") { showStats(items, progress); continue; }
      if (answer === "/skip" || !answer) { console.log(); continue; }

      const { embedding } = await embed({ modelId: embedId, text: [answer, expected] });
      const cos = cosine(embedding[0], embedding[1]);
      const kw = grounded ? keywordCoverage(expected, answer) : null;
      const score = scoreAnswer({ kw, cos, grounded });
      const v = verdict(score);

      const label = { correct: c.green("Correct"), partly: c.yellow("Partly correct"), wrong: c.red("Not quite") }[v];
      console.log(`\n${label}  ${c.dim(`(score ${score}%${grounded ? "" : ", approximate"})`)}`);
      if (grounded) console.log(c.bold("Expected: ") + expected);
      console.log(c.bold("From your notes: ") + c.dim(it.text));

      if (LANG === "hinglish") {
        process.stdout.write(c.bold("Hinglish: "));
        await ask(
          llmId,
          `Explain the sentence below in ONE simple Hinglish sentence (Hindi written in English letters). Do not add new facts.\n\nSentence: ${it.text}`,
          { maxTokens: 70, show: true }
        );
      }

      const old = progress[it.id] || { attempts: 0, avg: 0 };
      const attempts = old.attempts + 1;
      progress[it.id] = { attempts, avg: (old.avg * old.attempts + score) / attempts };
      saveProgress(progress);
      console.log(c.dim("\n-----------------------------------------\n"));
    }
    rl.close();
    showStats(items, progress);
  } catch (err) {
    console.error(c.red("\nError:"), err?.message || err);
    process.exitCode = 1;
  } finally {
    try { if (llmId) await unloadModel({ modelId: llmId }); } catch {}
    try { if (embedId) await unloadModel({ modelId: embedId }); } catch {}
    process.exit(process.exitCode || 0);
  }
}

main();
