import { parse } from 'smol-toml';
import fs from 'node:fs';
import path from 'node:path';

export function loadConfig(configPath) {
  const resolved = path.resolve(configPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }

  const tomlString = fs.readFileSync(resolved, 'utf-8');
  const config = parse(tomlString);

  if (!config.global?.secret_key) {
    throw new Error('Missing [global] secret_key in config.toml');
  }

  const policies = new Map();
  if (config.web) {
    for (const [webId, raw] of Object.entries(config.web)) {
      policies.set(webId, {
        webId,
        path: raw.path || '/',
        allowedRoots: Array.isArray(raw.allowed_roots) ? [...raw.allowed_roots] : [],
        types: Array.isArray(raw.types) ? [...raw.types] : [],
        webIdScope: raw.web_id || webId,
      });
    }
  }

  return {
    global: {
      secretKey: config.global.secret_key,
      thumbnailRoot: config.global.thumbnail_root || path.join(process.cwd(), 'thumbnails'),
      scanPeriodMinutes: Number(config.global.scan_period_minutes) || 15,
      scanBatchSize: Number(config.global.scan_batch_size) || 250,
      startupGraceMs: Number(config.global.startup_grace_ms) || 30000,
      probeTimeout: Number(config.global.probe_timeout) || 15000,
    },
    policies,
    raw: config,
  };
}
