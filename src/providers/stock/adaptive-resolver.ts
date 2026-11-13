import * as fs from "node:fs";
import * as path from "node:path";
import type { LanguageModel } from "ai";
import { optimizeImagePrompt } from "../../agents/image-prompter.js";
import type { PipelineCallbacks } from "../../pipeline/utils.js";
import type { ArchetypeConfig } from "../../schema/archetype.js";
import type {
  ImageProvider,
  LLMProvider,
  LLMUsage,
  StockCandidate,
  StockProvider,
} from "../../schema/providers.js";
import { reformulateStockQuery } from "./query-reformer.js";
import { verifyStockResult } from "./stock-verifier.js";

export interface StockResolutionAttempt {
  query: string;
  provider: string;
  candidateId: string;
  result: "verified" | "rejected" | "not_found";
  confidence?: number;
  reason?: string;
}

export interface StockResolution {
  method:
    | "stock_verified"
    | "stock_unverified"
    | "stock_best_effort"
    | "procedural_fallback"
    | "ai_fallback";
  attempts: StockResolutionAttempt[];
  originalQuery: string;
}

export interface AdaptiveResolverResult {
  path: string | null;
  usage: LLMUsage | null;
  durationSeconds: number | null;
  resolution: StockResolution;
  /** Attribution for the asset that was used, when the source needs it. */
  credit?: { license: string; author: string; sourceUrl: string };
}

interface ResolverConfig {
  llm: LLMProvider;
  imageGen: ImageProvider;
  stocks: StockProvider[];
  verifyModel: LanguageModel | null;
  confidenceThreshold: number;
  maxAttempts: number;
  callbacks?: PipelineCallbacks;
  archetype: ArchetypeConfig;
  /**
   * When true, never call the image provider. Stock resolution failures return
   * `path: null`, which the renderer turns into a procedural text card.
   */
  noAiFallback?: boolean;
}

/**
 * Resolve a stock scene with verification, retry, and AI fallback.
 *
 * Flow:
 *   1. Try original query on each provider (query-first ordering)
 *   2. If all rejected → reformulate → try reformulated queries
 *   3. If all fail → fall back to AI image generation, unless AI assets are disabled
 */
export async function resolveStockAdaptive(
  visualType: "stock_image" | "stock_video",
  visualPrompt: string,
  scriptLine: string,
  sceneIndex: number,
  totalScenes: number,
  assetsDir: string,
  config: ResolverConfig,
): Promise<AdaptiveResolverResult> {
  const attempts: StockResolutionAttempt[] = [];
  const seenAssetIds = new Set<string>();
  const llmUsages: LLMUsage[] = [];
  let totalApiCalls = 0;
  let verifyCalls = 0;
  // How close a rejected candidate has to be to be used anyway.
  const bestEffortFloor = 0.45;

  const isVideo = visualType === "stock_video";
  const searchFn = isVideo ? "searchVideo" : "searchImage";
  const ext = isVideo ? "mp4" : "jpg";
  // More candidates per query: a rejected candidate is not the end of the
  // road, and with three libraries in the loop there is usually a better one.
  const maxCandidatesPerQuery = isVideo ? 2 : 4;

  // The best candidate the judge turned down. Stock is the point of the
  // no-AI mode, so a near miss is used rather than thrown away.
  let bestRejected:
    | { candidate: StockCandidate; confidence: number; asset: { filePath: string } }
    | null = null;
  // A candidate the judge could not look at. It is kept, but it is the last
  // resort: a properly judged clip is always better, so the search keeps
  // going instead of stopping at the first frame it cannot check.
  let bestUnverified:
    | { candidate: StockCandidate; confidence: number; asset: { filePath: string } }
    | null = null;

  // Build the query list: original first, reformulated on demand
  const queries: string[] = [visualPrompt];
  let reformulated = false;

  for (let qi = 0; qi < queries.length && totalApiCalls < config.maxAttempts; qi++) {
    const query = queries[qi]!;

    for (const stock of config.stocks) {
      if (totalApiCalls >= config.maxAttempts) break;
      totalApiCalls++;

      const candidates = await stock[searchFn](query);
      if (candidates.length === 0) {
        attempts.push({
          query,
          provider: "unknown",
          candidateId: "",
          result: "not_found",
        });
        continue;
      }

      // Verify top N candidates, pick highest confidence
      const verifiedCandidates: Array<{
        candidate: StockCandidate;
        confidence: number;
        reason: string;
        asset: { filePath: string };
      }> = [];

      const toVerify = candidates.slice(0, maxCandidatesPerQuery);
      for (const candidate of toVerify) {
        if (seenAssetIds.has(candidate.id)) continue;
        seenAssetIds.add(candidate.id);
        if (verifyCalls >= config.maxAttempts * 3) break;
        verifyCalls++;

        // Lazy download: only download the candidate we're about to verify
        let asset: { filePath: string };
        try {
          asset = await stock.download(candidate);
        } catch (err) {
          console.warn(`[stock] Download failed for ${candidate.id}: ${err}`);
          attempts.push({
            query,
            provider: candidate.id.split("-")[0] ?? "unknown",
            candidateId: candidate.id,
            result: "rejected",
            reason: `Download failed: ${err}`,
          });
          continue;
        }

        // Skip verification if disabled
        if (!config.verifyModel) {
          const dest = path.join(assetsDir, `scene-${sceneIndex}-stock.${ext}`);
          fs.copyFileSync(asset.filePath, dest);
          const durationSeconds = isVideo ? (candidate.duration ?? null) : null;

          config.callbacks?.onProgress?.("visuals", {
            type: "stock_verified",
            scene: sceneIndex,
            query,
            confidence: -1,
          });

          return {
            path: dest,
            usage: null,
            durationSeconds,
            credit: candidate.credit,
            resolution: {
              method: "stock_unverified",
              attempts,
              originalQuery: visualPrompt,
            },
          };
        }

        const verification = await verifyStockResult(
          config.verifyModel,
          asset.filePath,
          visualPrompt,
          scriptLine,
          config.confidenceThreshold,
        );
        llmUsages.push(verification.usage);

        const providerName = candidate.id.split("-")[0] ?? "unknown";
        attempts.push({
          query,
          provider: providerName,
          candidateId: candidate.id,
          result: verification.relevant ? "verified" : "rejected",
          confidence: verification.confidence,
          reason: verification.reason,
        });

        config.callbacks?.onProgress?.("visuals", {
          type: verification.relevant ? "stock_verified" : "stock_rejected",
          scene: sceneIndex,
          query,
          confidence: verification.confidence,
          reason: verification.reason,
        });

        if (verification.relevant && verification.confidence >= 0) {
          verifiedCandidates.push({
            candidate,
            confidence: verification.confidence,
            reason: verification.reason,
            asset,
          });
        } else if (verification.confidence < 0 && !bestUnverified) {
          bestUnverified = { candidate, confidence: verification.confidence, asset };
        } else if (
          verification.confidence >= bestEffortFloor &&
          (!bestRejected || verification.confidence > bestRejected.confidence)
        ) {
          bestRejected = { candidate, confidence: verification.confidence, asset };
        }
      }

      // Pick the best verified candidate
      if (verifiedCandidates.length > 0) {
        const best = verifiedCandidates.sort((a, b) => b.confidence - a.confidence)[0]!;
        const dest = path.join(assetsDir, `scene-${sceneIndex}-stock.${ext}`);
        fs.copyFileSync(best.asset.filePath, dest);
        const durationSeconds = isVideo ? (best.candidate.duration ?? null) : null;

        const totalUsage = sumUsages(llmUsages);
        return {
          path: dest,
          usage: totalUsage,
          durationSeconds,
          credit: best.candidate.credit,
          resolution: {
            method: "stock_verified",
            attempts,
            originalQuery: visualPrompt,
          },
        };
      }
    }

    // After exhausting all providers for current query, reformulate if not done yet
    if (!reformulated && qi === 0) {
      reformulated = true;
      config.callbacks?.onProgress?.("visuals", {
        type: "stock_reformulated",
        scene: sceneIndex,
        queries: [],
      });

      const reform = await reformulateStockQuery(config.llm, visualPrompt, scriptLine);
      llmUsages.push(reform.usage);
      queries.push(...reform.queries);

      config.callbacks?.onProgress?.("visuals", {
        type: "stock_reformulated",
        scene: sceneIndex,
        queries: reform.queries,
      });
    }
  }

  // The judge could not look at this frame. It is still a frame, and it is
  // better than a text card, but only once nothing else has been found.
  if (!bestRejected && bestUnverified) {
    const dest = path.join(assetsDir, `scene-${sceneIndex}-stock.${ext}`);
    fs.copyFileSync(bestUnverified.asset.filePath, dest);
    const durationSeconds = isVideo ? (bestUnverified.candidate.duration ?? null) : null;

    config.callbacks?.onProgress?.("visuals", {
      type: "stock_rejected",
      scene: sceneIndex,
      query: visualPrompt,
      confidence: bestUnverified.confidence,
      reason: "Used a frame the judge could not check",
    });

    return {
      path: dest,
      usage: sumUsages(llmUsages),
      durationSeconds,
      credit: bestUnverified.candidate.credit,
      resolution: {
        method: "stock_unverified",
        attempts,
        originalQuery: visualPrompt,
      },
    };
  }

  // Nothing passed the judge, but a near miss is still a usable frame: a
  // parked car with the right bodywork beats a text card. Use the best of
  // what was turned down rather than throwing the scene away.
  if (bestRejected) {
    const dest = path.join(assetsDir, `scene-${sceneIndex}-stock.${ext}`);
    fs.copyFileSync(bestRejected.asset.filePath, dest);
    const durationSeconds = isVideo ? (bestRejected.candidate.duration ?? null) : null;

    config.callbacks?.onProgress?.("visuals", {
      type: "stock_rejected",
      scene: sceneIndex,
      query: visualPrompt,
      confidence: bestRejected.confidence,
      reason: "Best available match used",
    });

    return {
      path: dest,
      usage: sumUsages(llmUsages),
      durationSeconds,
      credit: bestRejected.candidate.credit,
      resolution: {
        method: "stock_best_effort",
        attempts,
        originalQuery: visualPrompt,
      },
    };
  }

  // All attempts exhausted — no AI assets mode renders a procedural text card.
  if (config.noAiFallback) {
    config.callbacks?.onProgress?.("visuals", {
      type: "stock_unavailable",
      scene: sceneIndex,
      attempts: attempts.length,
      fallback: "text_card",
    });
    return {
      path: null,
      usage: sumUsages(llmUsages),
      durationSeconds: null,
      resolution: {
        method: "procedural_fallback",
        attempts,
        originalQuery: visualPrompt,
      },
    };
  }

  // Fall back to AI image generation
  config.callbacks?.onProgress?.("visuals", {
    type: "stock_fallback",
    scene: sceneIndex,
    attempts: attempts.length,
  });

  // Build rejection context for negative examples
  const rejections = attempts
    .filter((a) => a.result === "rejected" && a.reason)
    .map((a) => `"${a.query}" returned: ${a.reason} (confidence: ${a.confidence?.toFixed(2)})`)
    .slice(0, 3);
  const rejectionContext =
    rejections.length > 0
      ? `Stock footage search failed. Rejected results:\n${rejections.join("\n")}\nGenerate an image that matches the original request, avoiding what the stock results showed.`
      : undefined;

  try {
    let prompt = visualPrompt;
    try {
      const optimized = await optimizeImagePrompt(
        config.llm,
        visualPrompt,
        scriptLine,
        sceneIndex,
        totalScenes,
        config.archetype,
        { rejectionContext },
      );
      prompt = optimized.prompt;
      llmUsages.push(optimized.usage);
    } catch (err) {
      console.warn(`[stock] AI fallback prompt optimization failed, using original: ${err}`);
    }

    const imageBuffer = await config.imageGen.generate(prompt);
    const filePath = path.join(assetsDir, `scene-${sceneIndex}-ai.png`);
    fs.writeFileSync(filePath, imageBuffer);

    return {
      path: filePath,
      usage: sumUsages(llmUsages),
      durationSeconds: null,
      resolution: {
        method: "ai_fallback",
        attempts,
        originalQuery: visualPrompt,
      },
    };
  } catch (err) {
    console.error(`[stock] AI fallback failed for scene ${sceneIndex}: ${err}`);
    console.error(`[stock] Full attempt history:`, JSON.stringify(attempts, null, 2));
    return {
      path: null,
      usage: sumUsages(llmUsages),
      durationSeconds: null,
      resolution: {
        method: "ai_fallback",
        attempts,
        originalQuery: visualPrompt,
      },
    };
  }
}

function sumUsages(usages: LLMUsage[]): LLMUsage {
  return usages.reduce(
    (acc, u) => ({
      inputTokens: acc.inputTokens + u.inputTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 },
  );
}
