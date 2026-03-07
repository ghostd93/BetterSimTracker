import type { CustomStatDefinition, StatKey } from "./types";

export function formatBuiltInProgressLabel(statList: StatKey[]): string {
  if (statList.length === 1) return `Built-in: ${statList[0]}`;
  return `Built-ins: ${statList.join(", ")}`;
}

export function formatCustomProgressLabel(statDef: CustomStatDefinition): string {
  return `Custom: ${statDef.label || statDef.id}`;
}

export function formatCustomGroupProgressLabel(group: CustomStatDefinition[]): string {
  return `Custom Group: ${group.map(stat => stat.id).join("+")}`;
}

export function buildProgressRequest(label: string): string {
  return `Requesting ${label}`;
}

export function buildProgressParse(label: string): string {
  return `Parsing ${label}`;
}

export function buildProgressApply(label: string): string {
  return `Applying ${label}`;
}

export function buildProgressSeedingDefaults(batchLabel: string): string {
  return `Seeding defaults (${batchLabel})`;
}

export function buildProgressNoExtractionNeeded(batchLabel: string): string {
  return `No extraction needed (${batchLabel})`;
}

export function buildProgressApplyingDefaults(batchLabel: string): string {
  return `Applying defaults (${batchLabel})`;
}

export function buildProgressUnifiedBatch(batchLabel: string): string {
  return `Unified Batch (${batchLabel})`;
}

