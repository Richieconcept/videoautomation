import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CREATORS } from './defaultCreators.js';

const STORE_PATH = path.resolve(process.env.AUTOMATION_STORE_PATH || 'storage/automation/state.json');

function now() {
  return new Date().toISOString();
}

function sourceFromConfig(creatorId, source) {
  return {
    id: source.id || randomUUID(),
    creatorId,
    platform: source.platform,
    profileUrl: source.url || source.profileUrl,
    enabled: source.enabled !== false,
    lastCheckedAt: null,
    lastSeenPostId: null,
    lastSeenPublishedAt: null,
    lastError: null,
    createdAt: now(),
    updatedAt: now()
  };
}

function initialState() {
  const creators = DEFAULT_CREATORS.map((creator) => ({
    id: creator.id,
    name: creator.name,
    aliases: creator.aliases,
    priority: creator.priority,
    enabled: creator.enabled,
    createdAt: now(),
    updatedAt: now()
  }));
  const sources = DEFAULT_CREATORS.flatMap((creator) => creator.sources.map((source) => sourceFromConfig(creator.id, source)));

  return {
    settings: {
      autoSourcingEnabled: process.env.AUTO_SOURCING_ENABLED === 'true',
      bootstrapCompleted: false,
      lastCycleAt: null,
      nextCycleAt: null
    },
    creators,
    sources,
    posts: [],
    jobs: [],
    counters: {
      discoveredToday: 0,
      processedToday: 0,
      queuedToday: 0,
      publishedToday: 0,
      duplicatesSkippedToday: 0,
      failedToday: 0,
      date: new Date().toISOString().slice(0, 10)
    }
  };
}

async function ensureStore() {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    await writeState(initialState());
  }
}

function resetCountersIfNeeded(state) {
  const today = new Date().toISOString().slice(0, 10);
  if (state.counters?.date === today) return state;
  state.counters = {
    discoveredToday: 0,
    processedToday: 0,
    queuedToday: 0,
    publishedToday: 0,
    duplicatesSkippedToday: 0,
    failedToday: 0,
    date: today
  };
  return state;
}

export async function readState() {
  await ensureStore();
  const raw = await fs.readFile(STORE_PATH, 'utf8');
  return resetCountersIfNeeded(JSON.parse(raw));
}

export async function writeState(state) {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

export async function updateState(mutator) {
  const state = await readState();
  const updated = await mutator(state) || state;
  await writeState(updated);
  return updated;
}

export function newId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

export async function addCreator(input) {
  return updateState((state) => {
    const creatorId = newId('creator');
    state.creators.push({
      id: creatorId,
      name: input.name,
      aliases: input.aliases || [],
      priority: input.priority || 'normal',
      enabled: input.enabled !== false,
      createdAt: now(),
      updatedAt: now()
    });
    ['facebook', 'tiktok', 'youtube'].forEach((platform) => {
      const url = input[`${platform}Url`];
      if (!url) return;
      state.sources.push({
        id: newId('source'),
        creatorId,
        platform,
        profileUrl: url,
        enabled: true,
        lastCheckedAt: null,
        lastSeenPostId: null,
        lastSeenPublishedAt: null,
        lastError: null,
        createdAt: now(),
        updatedAt: now()
      });
    });
    return state;
  });
}
