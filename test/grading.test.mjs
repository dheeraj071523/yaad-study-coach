import test from "node:test";
import assert from "node:assert/strict";
import {
  splitSentences, isGrounded, keywordCoverage, scoreAnswer, verdict, cosine,
} from "../src/grading.mjs";

test("splitSentences skips headings and very short lines", () => {
  const s = splitSentences("# Title\n\nVenus is the hottest planet because of its thick atmosphere. Short one.");
  assert.equal(s.length, 1);
});

test("isGrounded only accepts text that is inside the sentence", () => {
  const sent = "Venus is the hottest planet in the solar system.";
  assert.equal(isGrounded("Venus", sent), true);
  assert.equal(isGrounded("Mercury", sent), false);
});

test("keywordCoverage handles case, plural and partial answers", () => {
  assert.equal(keywordCoverage("Venus", "venus"), 1);
  assert.equal(keywordCoverage("Io, Europa, Ganymede and Callisto", "io europa ganymede callisto"), 1);
  assert.equal(keywordCoverage("Io, Europa, Ganymede and Callisto", "Io, Europa"), 0.5);
  assert.equal(keywordCoverage("Venus", "mercury"), 0);
});

test("a correct short answer scores high, a wrong one low", () => {
  assert.equal(verdict(scoreAnswer({ kw: 1, cos: 0.95, grounded: true })), "correct");
  assert.equal(verdict(scoreAnswer({ kw: 0, cos: 0.6, grounded: true })), "wrong");
  assert.equal(verdict(scoreAnswer({ kw: 0.5, cos: 0.7, grounded: true })), "partly");
});

test("cosine of identical vectors is 1", () => {
  assert.ok(Math.abs(cosine([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
});
