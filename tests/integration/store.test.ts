import { describe, expect, test } from "vitest";
import { createMemoryStore } from "@/lib/store";
import { demoTopic, stableClaimId, stableSourceId } from "@/lib/demo-data";

describe("memory store fallback", () => {
  test("persists separate hydra and workflow statuses", async () => {
    const store = createMemoryStore({ seedDemoData: false });
    await store.upsertTopic(demoTopic);

    const id = stableSourceId(demoTopic.id, "https://example.com/dual-status");
    await store.upsertSource({
      id,
      topicId: demoTopic.id,
      url: "https://example.com/dual-status",
      title: "Dual status",
      publisher: "Example",
      publishedAt: "2026-05-17T00:00:00.000Z",
      ingestedAt: "2026-05-17T00:00:00.000Z",
      hydraStatus: "in_progress",
      workflowStatus: "complete",
      workflowRunId: "wf-2",
      bodyExcerpt: null,
    });

    const source = await store.getSource(id);
    expect(source?.hydraStatus).toBe("in_progress");
    expect(source?.workflowStatus).toBe("complete");

    await store.updateSourceWorkflowStatus(id, "failed_upload");
    const after = await store.getSource(id);
    expect(after?.workflowStatus).toBe("failed_upload");
    expect(after?.hydraStatus).toBe("in_progress");
  });

  test("upsertEntityWithAliases collapses different ids with same canonical name", async () => {
    const store = createMemoryStore({ seedDemoData: false });
    await store.upsertTopic(demoTopic);

    const first = await store.upsertEntityWithAliases({
      entity: {
        id: "gpt-5",
        topicId: demoTopic.id,
        canonicalName: "GPT-5",
        entityType: "MODEL",
        hydraEntityId: null,
        firstSeen: "2026-05-17T00:00:00.000Z",
      },
      aliases: ["GPT-5"],
    });

    const second = await store.upsertEntityWithAliases({
      entity: {
        id: "gpt5",
        topicId: demoTopic.id,
        canonicalName: "GPT-5",
        entityType: "MODEL",
        hydraEntityId: "hydra-gpt-5",
        firstSeen: "2026-05-17T01:00:00.000Z",
      },
      aliases: ["gpt5"],
    });

    expect(second.id).toBe(first.id);
    expect(second.hydraEntityId).toBe("hydra-gpt-5");

    await store.upsertEntityWithAliases({
      entity: { ...first, hydraEntityId: "hydra-gpt-5" },
      aliases: ["gpt 5 alpha"],
    });
    const aliasLookup = await store.findEntityByAlias("gpt 5 alpha");
    expect(aliasLookup?.id).toBe(first.id);

    const page = await store.getEntityPage("gpt5");
    expect(page?.entity.id).toBe(first.id);
  });

  test("model-family alias resolves to canonical entity page", async () => {
    const store = createMemoryStore({ seedDemoData: false });
    await store.upsertTopic(demoTopic);
    await store.upsertEntityWithAliases({
      entity: {
        id: "gpt-5-5-instant",
        topicId: demoTopic.id,
        canonicalName: "GPT-5.5 Instant",
        entityType: "MODEL",
        hydraEntityId: null,
        firstSeen: "2026-05-17T00:00:00.000Z",
      },
      aliases: ["GPT-5.5 Instant", "gpt-5", "gpt5"],
    });

    const resolved = await store.findEntityByAlias("gpt-5");
    expect(resolved?.id).toBe("gpt-5-5-instant");
  });

  test("upserts ingest data idempotently without a database", async () => {
    const store = createMemoryStore({ seedDemoData: false });
    await store.upsertTopic(demoTopic);

    const sourceId = stableSourceId(demoTopic.id, "https://example.com/new-source");
    const source = await store.upsertSource({
      id: sourceId,
      topicId: demoTopic.id,
      url: "https://example.com/new-source",
      title: "New source",
      publisher: "Example",
      publishedAt: "2026-05-16T12:00:00.000Z",
      ingestedAt: "2026-05-16T12:01:00.000Z",
      hydraStatus: "queued",
      workflowStatus: "pending",
      workflowRunId: "wf-1",
      bodyExcerpt: null,
    });
    await store.upsertSource({ ...source, title: "New source updated" });
    await store.updateSourceStatus(sourceId, "success");

    const entity = await store.upsertEntityWithAliases({
      entity: {
        id: "new-model",
        topicId: demoTopic.id,
        canonicalName: "New Model",
        entityType: "MODEL",
        hydraEntityId: "hydra-new-model",
        firstSeen: "2026-05-16T12:02:00.000Z",
      },
      aliases: ["newmodel", "New Model"],
    });
    await store.upsertEntityWithAliases({ entity, aliases: ["new model"] });
    await store.upsertEntityWithAliases({
      entity: {
        ...entity,
        canonicalName: "New Model",
        hydraEntityId: null,
        firstSeen: "2026-05-16T13:00:00.000Z",
      },
      aliases: ["new model"],
    });

    const claimId = stableClaimId(sourceId, "New Model shipped.");
    const [claim] = await store.insertClaims([
      {
        id: claimId,
        sourceId,
        entityId: entity.id,
        claimText: "New Model shipped.",
        stance: "factual",
        confidence: 0.91,
        chunkUuid: "chunk-1",
        evidenceQuote: null,
        extractedAt: "2026-05-16T12:03:00.000Z",
      },
    ]);
    await store.insertClaims([{ ...claim, confidence: 0.95 }]);
    await store.upsertLede({
      entityId: entity.id,
      lede: "New Model has one sourced launch claim.",
      sourceCountAtGen: 1,
      generatedAt: "2026-05-16T12:04:00.000Z",
    });

    const saved = await store.saveQuery("What shipped?", "New Model shipped.", [sourceId]);
    const secondSaved = await store.saveQuery("What shipped?", "New Model shipped again.", [sourceId]);
    const page = await store.getEntityPage("newmodel");
    const dashboard = await store.getDashboard();
    const graph = await store.getGraphData();

    expect((await store.listSources()).map((item) => item.id)).toEqual([sourceId]);
    expect(await store.getSource(sourceId)).toMatchObject({ id: sourceId, hydraStatus: "success" });
    expect(await store.getSourcesByIds([sourceId, "missing"])).toHaveLength(1);
    expect(page?.entity.id).toBe(entity.id);
    expect(page?.entity.firstSeen).toBe("2026-05-16T12:02:00.000Z");
    expect(page?.entity.hydraEntityId).toBe("hydra-new-model");
    expect(page?.aliases.map((item) => item.alias).sort()).toEqual(["new model", "newmodel"]);
    expect(page?.claims).toHaveLength(1);
    expect(page?.claims[0].confidence).toBe(0.95);
    expect(page?.lede?.lede).toContain("launch claim");
    expect(dashboard.stats.sources).toBe(1);
    expect(dashboard.stats.claims).toBe(1);
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(["new-model", `source:${sourceId}`]);
    expect(graph.edges).toEqual([
      expect.objectContaining({ source: `source:${sourceId}`, target: "new-model", relation: "mentions" }),
    ]);
    expect((await store.getSavedQuery(saved.slug))?.id).toBe(saved.id);
    expect(secondSaved.id).not.toBe(saved.id);
    expect(secondSaved.slug).not.toBe(saved.slug);
  });

  test("graph omits source nodes that have zero claims", async () => {
    const store = createMemoryStore({ seedDemoData: false });
    await store.upsertTopic(demoTopic);

    const usedSourceId = stableSourceId(demoTopic.id, "https://example.com/used");
    const orphanSourceId = stableSourceId(demoTopic.id, "https://example.com/orphan");
    await store.upsertSource({
      id: usedSourceId,
      topicId: demoTopic.id,
      url: "https://example.com/used",
      title: "Used",
      publisher: "Example",
      publishedAt: "2026-05-17T00:00:00.000Z",
      ingestedAt: "2026-05-17T00:00:00.000Z",
      hydraStatus: "success",
      workflowStatus: "complete",
      workflowRunId: "wf-used",
      bodyExcerpt: null,
    });
    await store.upsertSource({
      id: orphanSourceId,
      topicId: demoTopic.id,
      url: "https://example.com/orphan",
      title: "Orphan",
      publisher: "Example",
      publishedAt: "2026-05-17T00:00:00.000Z",
      ingestedAt: "2026-05-17T00:00:00.000Z",
      hydraStatus: "queued",
      workflowStatus: "pending",
      workflowRunId: "wf-orphan",
      bodyExcerpt: null,
    });
    const entity = await store.upsertEntityWithAliases({
      entity: {
        id: "model-x",
        topicId: demoTopic.id,
        canonicalName: "Model X",
        entityType: "MODEL",
        hydraEntityId: null,
        firstSeen: "2026-05-17T00:00:00.000Z",
      },
      aliases: ["Model X"],
    });
    await store.insertClaims([
      {
        id: stableClaimId(usedSourceId, "Model X shipped."),
        sourceId: usedSourceId,
        entityId: entity.id,
        claimText: "Model X shipped.",
        stance: "factual",
        confidence: 0.9,
        chunkUuid: null,
        evidenceQuote: null,
        extractedAt: "2026-05-17T00:00:00.000Z",
      },
    ]);

    const graph = await store.getGraphData();
    const sourceNodes = graph.nodes.filter((node) => node.id.startsWith("source:"));
    expect(sourceNodes.map((node) => node.id)).toEqual([`source:${usedSourceId}`]);
    const usedNode = sourceNodes.find((node) => node.id === `source:${usedSourceId}`);
    expect(usedNode?.claimCount).toBe(1);
  });
});
