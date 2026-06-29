// Runtime configuration loaded entirely from environment variables.
// No config file — set vars in your shell, .env, or container manifest.
//
// Server vars:
//   CALSTAKK_HOST          Bind address              (default: 127.0.0.1)
//   CALSTAKK_PORT          Listen port               (default: 5232)
//   CALSTAKK_KV_PATH       Deno KV database path     (default: Deno default)
//   CALSTAKK_WEB_DIR       Static web UI directory   (default: none)
//
// User / principal vars (the single owner of this private server):
//   CALSTAKK_USERNAME      HTTP Basic Auth username  (default: calstakk)
//   CALSTAKK_PASSWORD      HTTP Basic Auth password  (default: none = no auth)
//   CALSTAKK_DISPLAY_NAME  Principal display name    (default: CalStakk)
//   CALSTAKK_EMAIL         Owner email address       (default: none)
//   CALSTAKK_TIMEZONE      Default IANA timezone     (default: UTC)

export interface ServerConfig {
  host: string;
  port: number;
  kvPath: string | undefined;
  webDir: string | undefined;
}

export interface UserConfig {
  username: string;
  /** Empty string means no authentication required. */
  password: string;
  displayName: string;
  /** Primary email — used for calendar-user-address-set in scheduling. */
  email: string;
  /** IANA timezone identifier, e.g. "Europe/London". */
  timezone: string;
}

export interface Config {
  server: ServerConfig;
  user: UserConfig;
}

export function loadConfig(): Config {
  const host = env("CALSTAKK_HOST", "127.0.0.1");
  const rawPort = env("CALSTAKK_PORT", "5232");
  const port = parseInt(rawPort, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`CALSTAKK_PORT: invalid port "${rawPort}"`);
  }

  return {
    server: {
      host,
      port,
      kvPath: env("CALSTAKK_KV_PATH", "") || undefined,
      webDir: env("CALSTAKK_WEB_DIR", "web/dist") || undefined,
    },
    user: {
      username: env("CALSTAKK_USERNAME", "calstakk"),
      password: env("CALSTAKK_PASSWORD", ""),
      displayName: env("CALSTAKK_DISPLAY_NAME", "CalStakk"),
      email: env("CALSTAKK_EMAIL", ""),
      timezone: env("CALSTAKK_TIMEZONE", "UTC"),
    },
  };
}

function env(key: string, fallback: string): string {
  return Deno.env.get(key) ?? fallback;
}
