// test/graph.test.js — link parsing, similarity, graph build and caching.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { freshDataDir, removeDir, loadDist } from "./helpers.js";

const dataDir = freshDataDir("graph");
let storage, graph;

before(async () => {
  storage = await loadDist("storage.js");
  graph = await loadDist("graph.js");
  await storage.ensureDataDir();
});
after(() => removeDir(dataDir));

test("parseLinks detects md + wiki links, rejects invalid/traversal", () => {
  const refs = graph.parseLinks(
    "See [o](/ctx/projx/notes) and [[ideas]] and [[projy/spec]] and [bad](/ctx/..) and [[no spaces]]",
    "home"
  );
  const keys = refs.map((r) => `${r.context}/${r.item ?? ""}`);
  assert.ok(keys.includes("projx/notes"));
  assert.ok(keys.includes("home/ideas"));
  assert.ok(keys.includes("projy/spec"));
  assert.ok(!keys.some((k) => k.includes("..")));
  assert.ok(!keys.includes("home/no spaces"));
});

test("tfidf groups topically-similar docs", () => {
  const rel = graph.tfidfRelated(
    [
      { id: "db1", text: "database schema migration postgres index query table" },
      { id: "db2", text: "postgres database index query performance table tuning" },
      { id: "ui1", text: "button layout flexbox component render viewport spacing" },
    ],
    2,
    0.0
  );
  assert.equal(rel.get("db1")[0].id, "db2");
});

test("build yields outbound links + backlinks", async () => {
  await storage.createContext("gctxa");
  await storage.createContext("gctxb");
  await storage.createItem("gctxa", "alpha", "md", { content: "About databases. See [[gctxb/beta]] and [g](/ctx/gctxa/gamma)." });
  await storage.createItem("gctxb", "beta", "md", { content: "Database indexing and queries." });
  await storage.createItem("gctxa", "gamma", "md", { content: "Unrelated UI flexbox layout." });
  graph.invalidateGraphCache();
  const a = await graph.getItemConnections("gctxa", "alpha");
  assert.deepEqual(a.outbound.map((o) => o.id).sort(), ["gctxa/gamma", "gctxb/beta"]);
  const beta = await graph.getItemConnections("gctxb", "beta");
  assert.deepEqual(beta.backlinks.map((b) => b.id), ["gctxa/alpha"]);
});

test("ollama similarity backend falls back to tf-idf when unreachable", async () => {
  process.env.CONTEXTS_SIMILARITY = "ollama";
  process.env.CONTEXTS_OLLAMA_URL = "http://127.0.0.1:1";
  try {
    graph.invalidateGraphCache();
    const g = await graph.buildGraph();
    assert.ok(g.nodes.length > 0);
  } finally {
    delete process.env.CONTEXTS_SIMILARITY;
    delete process.env.CONTEXTS_OLLAMA_URL;
    graph.invalidateGraphCache();
  }
});

test("archived contexts excluded by default, included on opt-in", async () => {
  await storage.createContext("garc");
  await storage.updateContextMetadata("garc", { status: "archived" });
  await storage.createItem("garc", "secret", "md", { content: "an archived item" });
  graph.invalidateGraphCache();
  assert.ok(!(await graph.getGraph()).nodes.some((n) => n.id === "garc/secret"));
  assert.ok((await graph.getGraph(true)).nodes.some((n) => n.id === "garc/secret"));
  graph.invalidateGraphCache();
});

test("related edges are undirected and deduped (one per pair)", async () => {
  await storage.createContext("grel");
  await storage.createItem("grel", "db1", "md", { content: "database schema migration postgres index query table tuning" });
  await storage.createItem("grel", "db2", "md", { content: "postgres database index query table migration schema performance" });
  graph.invalidateGraphCache();
  const g = await graph.getGraph();
  const pair = g.edges.filter(
    (e) => e.kind === "related" && ((e.source === "grel/db1" && e.target === "grel/db2") || (e.source === "grel/db2" && e.target === "grel/db1"))
  );
  assert.equal(pair.length, 1);
  graph.invalidateGraphCache();
});

test("an explicit link suppresses the related edge for the same pair", async () => {
  await storage.createContext("gsup");
  await storage.createItem("gsup", "a", "md", { content: "database schema migration postgres index. See [[gsup/b]]." });
  await storage.createItem("gsup", "b", "md", { content: "database schema migration postgres index query table." });
  graph.invalidateGraphCache();
  const g = await graph.getGraph();
  assert.ok(g.edges.some((e) => e.kind === "link" && e.source === "gsup/a" && e.target === "gsup/b"));
  assert.ok(
    !g.edges.some((e) => e.kind === "related" && ((e.source === "gsup/a" && e.target === "gsup/b") || (e.source === "gsup/b" && e.target === "gsup/a")))
  );
  graph.invalidateGraphCache();
});

test("build persists a disk cache keyed to the corpus signature", async () => {
  await storage.createContext("gdisk");
  await storage.createItem("gdisk", "one", "md", { content: "cached graph item" });
  graph.invalidateGraphCache();
  await graph.getGraph();
  const disk = await storage.readGraphCacheFile();
  assert.ok(disk && typeof disk === "object");
  assert.equal(disk.signature, await storage.corpusSignature());
  assert.ok(disk.graph?.nodes?.some((n) => n.id === "gdisk/one"));
  assert.ok(Array.isArray(disk.archived));
  await storage.updateItem("gdisk", "one", { content: "cached graph item, edited" });
  assert.notEqual(disk.signature, await storage.corpusSignature());
  await storage.deleteContext("gdisk");
  graph.invalidateGraphCache();
});

test("corpus signature is stable across reads, moves on mutation", async () => {
  await storage.createContext("gsig");
  await storage.createItem("gsig", "one", "md", { content: "first item" });
  const sigA = await storage.corpusSignature();
  assert.equal(sigA, await storage.corpusSignature());
  await storage.updateItem("gsig", "one", { content: "first item, edited" });
  const sigB = await storage.corpusSignature();
  assert.notEqual(sigB, sigA);
  await storage.createItem("gsig", "two", "md", { content: "second item" });
  const sigC = await storage.corpusSignature();
  assert.notEqual(sigC, sigB);
  await storage.deleteContext("gsig");
  assert.notEqual(await storage.corpusSignature(), sigC);
});

test("a read after a write serves a graph without blocking, and converges", async () => {
  // Stale-while-revalidate: once a graph exists, a mutation must not make the
  // next connections lookup pay a synchronous rebuild. The result may be one
  // write behind, but a later read must reflect the change.
  await storage.createContext("gswr");
  await storage.createItem("gswr", "a", "md", { content: "first" });
  await storage.createItem("gswr", "b", "md", { content: "second" });
  graph.invalidateGraphCache();
  await graph.getGraph(true); // warm
  await storage.updateItem("gswr", "a", { content: "first, now links to [[gswr/b]]" });
  const t0 = process.hrtime.bigint();
  await graph.getItemConnections("gswr", "a");
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 50, `stale read should be fast, took ${ms.toFixed(1)}ms`);
  await graph.whenFresh();
  const c = await graph.getItemConnections("gswr", "a");
  assert.deepEqual(c.outbound.map((o) => o.id), ["gswr/b"]);
  graph.invalidateGraphCache();
});

test("pruned similarity finds the same neighbour as the exact pass", () => {
  const docs = [
    { id: "db1", text: "database schema migration postgres index query table" },
    { id: "db2", text: "postgres database index query performance table tuning" },
    { id: "ui1", text: "button layout flexbox component render viewport spacing" },
  ];
  const pruned = graph.prunedRelated(
    docs.map((d) => ({ id: d.id, tf: graph.termFrequencies(d.text) })),
    { threshold: 0 }
  );
  assert.equal(pruned.get("db1")[0].id, "db2");
  assert.equal(pruned.get("ui1").length, 0, "no shared terms means no candidate at all");
});

test("pruned similarity stays fast on a 600-document corpus", () => {
  const vocab = Array.from({ length: 2000 }, (_, i) => "term" + i.toString(36));
  let seed = 3;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const docs = [];
  for (let i = 0; i < 600; i++) {
    const words = [];
    for (let w = 0; w < 500; w++) words.push(vocab[Math.floor(rnd() * rnd() * vocab.length)]);
    docs.push({ id: "d" + i, tf: graph.termFrequencies(words.join(" "), 150) });
  }
  const t0 = process.hrtime.bigint();
  const rel = graph.prunedRelated(docs);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(rel.size, 600);
  assert.ok(ms < 1500, `pruned similarity over 600 docs took ${ms.toFixed(0)}ms`);
});

test("automatic rebuild re-indexes only changed items; full rebuild re-indexes everything", async () => {
  await storage.createContext("ginc");
  await storage.createItem("ginc", "a", "md", { content: "first alpha" });
  await storage.createItem("ginc", "b", "md", { content: "second beta" });
  graph.invalidateGraphCache();
  const first = await graph.rebuildGraph("auto");
  assert.ok(first.reindexed >= 2);
  const again = await graph.rebuildGraph("auto");
  assert.equal(again.reindexed, 0, "nothing changed, nothing re-tokenized");
  await storage.updateItem("ginc", "a", { content: "first alpha, now links to [[ginc/b]]" });
  const after = await graph.rebuildGraph("auto");
  assert.equal(after.reindexed, 1, "only the edited item is re-tokenized");
  assert.equal(after.rescored, 1, "only the edited item is re-scored");
  assert.equal(after.pass, "incremental");
  assert.deepEqual((await graph.getItemConnections("ginc", "a")).outbound.map((o) => o.id), ["ginc/b"]);
  const full = await graph.rebuildGraph("full");
  assert.equal(full.mode, "full");
  assert.equal(full.pass, "exact");
  assert.equal(full.similarity, "tfidf");
  assert.equal(full.reindexed, full.nodes, "full mode re-indexes every node");
  assert.equal(full.rescored, full.nodes);
  assert.ok((await storage.readGraphIndexFile())?.docs?.["ginc/a"], "index persisted to disk");
  graph.invalidateGraphCache();
});

test("search reads unchanged files from the corpus cache and sees edits immediately", async () => {
  await storage.createContext("scache");
  await storage.createItem("scache", "n", "md", { title: "Note", content: "needle one" });
  const search = await loadDist("search.js");
  let r = await search.searchContexts(dataDir, "needle", {});
  assert.equal(r.total, 1);
  await storage.editItem("scache", "n", "needle", "thread");
  r = await search.searchContexts(dataDir, "needle", {});
  assert.equal(r.total, 0, "edit must invalidate the cached copy");
  r = await search.searchContexts(dataDir, "thread", {});
  assert.equal(r.total, 1);
  await storage.deleteItem("scache", "n");
  r = await search.searchContexts(dataDir, "thread", {});
  assert.equal(r.total, 0, "deleted file must be evicted");
});

test("incremental rebuild patches neighbour lists on both sides", async () => {
  const dbText = "database schema migration postgres index query table tuning replication vacuum";
  const uiText = "button layout flexbox component render viewport spacing padding margin toolbar";
  await storage.createContext("gpatch");
  await storage.createItem("gpatch", "db1", "md", { content: dbText });
  await storage.createItem("gpatch", "db2", "md", { content: dbText + " performance" });
  await storage.createItem("gpatch", "ui1", "md", { content: uiText });
  graph.invalidateGraphCache();
  await graph.rebuildGraph("auto");
  const rel = async (id) => (await graph.getItemConnections("gpatch", id)).related.map((r) => r.id);
  assert.ok((await rel("db1")).includes("gpatch/db2"), "db1 ~ db2 initially");
  assert.ok(!(await rel("ui1")).includes("gpatch/db1"), "ui1 unrelated to db1");

  // Rewrite db1 to be about UI: its list changes, AND db2's list must drop it.
  await storage.updateItem("gpatch", "db1", { content: uiText + " widget" });
  const s = await graph.rebuildGraph("auto");
  assert.equal(s.pass, "incremental");
  assert.equal(s.rescored, 1);
  assert.ok(!(await rel("db1")).includes("gpatch/db2"), "db1 no longer ~ db2");
  assert.ok(!(await rel("db2")).includes("gpatch/db1"), "db2's list dropped db1 (symmetric patch)");
  assert.ok((await rel("db1")).includes("gpatch/ui1"), "db1 now ~ ui1");
  assert.ok((await rel("ui1")).includes("gpatch/db1"), "ui1 gained db1");

  // A new doc gets scored in, and existing lists gain it where it beats them.
  await storage.createItem("gpatch", "db3", "md", { content: dbText + " indexes" });
  const s2 = await graph.rebuildGraph("auto");
  assert.equal(s2.pass, "incremental");
  assert.ok((await rel("db2")).includes("gpatch/db3"), "db2 gained the new db3");

  // Deleting a doc removes it from everyone's list.
  await storage.deleteItem("gpatch", "db3");
  await graph.rebuildGraph("auto");
  assert.ok(!(await rel("db2")).includes("gpatch/db3"), "deleted doc evicted from neighbours");
  const g = await graph.getGraph(true);
  assert.ok(!g.edges.some((e) => e.source === "gpatch/db3" || e.target === "gpatch/db3"));
  graph.invalidateGraphCache();
});

test("a cold process resumes from the persisted index without re-tokenizing or re-scoring", async () => {
  await storage.createContext("gcold");
  await storage.createItem("gcold", "a", "md", { content: "database schema migration postgres index" });
  await storage.createItem("gcold", "b", "md", { content: "database schema migration postgres query" });
  graph.invalidateGraphCache();
  await graph.rebuildGraph("auto");
  graph.invalidateGraphCache(); // drops memory (like a new process); index reloads from disk
  const s = await graph.rebuildGraph("auto");
  assert.equal(s.reindexed, 0);
  assert.equal(s.rescored, 0);
  assert.equal(s.pass, "incremental");
  const rel = (await graph.getItemConnections("gcold", "a")).related.map((r) => r.id);
  assert.ok(rel.includes("gcold/b"), "neighbour lists came back from disk");
  graph.invalidateGraphCache();
});
