/**
 * Plugin-owned preferences: which of your packages to track, and an optional GitHub
 * token for live star counts.
 *
 * Kept in the plugin's own folder rather than the profile patch so the panel can
 * write it without a restart and without editing a file the user shares with every
 * other plugin. `$DSH_HOME/publisher-radar/config.json`.
 *
 * The token is a secret, so it follows the same rule the rest of this plugin does:
 * it may be written, never read back out. `status()` reports only whether one is set.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CONFIG_FILE = 'config.json';

function configPath(cacheDir) {
  return join(cacheDir, CONFIG_FILE);
}

/** Read the stored preferences. A malformed file degrades to empty, never throws. */
export function loadPrefs(cacheDir) {
  const file = configPath(cacheDir);
  if (!existsSync(file)) return { myPlugins: [], githubToken: '' };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return {
      myPlugins: Array.isArray(raw?.myPlugins)
        ? raw.myPlugins.filter((name) => typeof name === 'string' && name.trim() !== '').map((name) => name.trim()).slice(0, 50)
        : [],
      githubToken: typeof raw?.githubToken === 'string' ? raw.githubToken.trim() : '',
    };
  } catch {
    return { myPlugins: [], githubToken: '' };
  }
}

/**
 * Persist preferences.
 *
 * `githubToken` is tri-state: `undefined` keeps whatever is stored, `''` clears it,
 * any other string replaces it. That is what lets the panel save package names
 * without ever receiving — or resending — the secret.
 */
export function savePrefs(cacheDir, patch) {
  const current = loadPrefs(cacheDir);
  const next = {
    myPlugins: Array.isArray(patch?.myPlugins)
      ? patch.myPlugins.filter((name) => typeof name === 'string' && name.trim() !== '').map((name) => name.trim()).slice(0, 50)
      : current.myPlugins,
    githubToken: typeof patch?.githubToken === 'string' ? patch.githubToken.trim() : current.githubToken,
  };
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(configPath(cacheDir), JSON.stringify(next, null, 2), 'utf8');
    try { chmodSync(configPath(cacheDir), 0o600); } catch { /* Windows has no mode bits */ }
  } catch {
    return { ok: false, ...statusOf(next) };
  }
  return { ok: true, ...statusOf(next) };
}

/** What the panel is allowed to know about the stored secret: whether it exists. */
export function statusOf(prefs) {
  return { myPlugins: prefs.myPlugins, hasToken: prefs.githubToken !== '' };
}
