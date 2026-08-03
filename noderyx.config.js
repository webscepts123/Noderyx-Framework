import { envBoolean, envList, envNumber, securityProfile } from "./framework/index.js";

const databaseType = (process.env.DB_TYPE ?? "mysql").toLowerCase();
const aiProviderName = (process.env.AI_PROVIDER ?? "openai").toLowerCase();
const aiProvider = aiProviderName === "claude" ? "anthropic" : aiProviderName;
const usingClaude = aiProvider === "anthropic";

function databaseConfig() {
  if (databaseType === "postgres" || databaseType === "postgresql") {
    return {
      type: "postgres",
      connectionString: process.env.DATABASE_URL,
      poolMin: envNumber("DB_POOL_MIN", 0),
      poolMax: envNumber("DB_POOL_MAX", 10)
    };
  }
  if (databaseType === "mongo" || databaseType === "mongodb") {
    return {
      type: "mongo",
      url: process.env.MONGODB_URL,
      database: process.env.DB_NAME
    };
  }
  return {
    type: "mysql",
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: envNumber("DB_PORT", 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME,
    connectionLimit: envNumber("DB_POOL_MAX", 10)
  };
}

export default {
  app: {
    name: process.env.APP_NAME ?? process.env.SITE_NAME ?? "Noderyx",
    environment: process.env.NODE_ENV ?? "development",
    debug: envBoolean("APP_DEBUG", process.env.NODE_ENV !== "production"),
    url: process.env.APP_URL ?? process.env.SITE_URL ?? "http://localhost:3000",
    timezone: process.env.APP_TIMEZONE ?? "UTC",
    locale: process.env.APP_LOCALE ?? "en",
    logLevel: process.env.LOG_LEVEL ?? "info"
  },

  // Local packages under packages/ load automatically. Add published packages here.
  packages: [],

  ai: {
    provider: aiProvider,
    enabled: envBoolean("AI_ENABLED", false),
    apiKey: usingClaude ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY,
    baseURL: usingClaude
      ? process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1"
      : process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    model: usingClaude
      ? process.env.ANTHROPIC_MODEL ?? "claude-opus-5"
      : process.env.OPENAI_MODEL ?? "gpt-5.6-sol",
    reasoningEffort: process.env.AI_REASONING_EFFORT ?? "medium",
    verbosity: process.env.AI_VERBOSITY ?? "medium",
    maxOutputTokens: envNumber("AI_MAX_OUTPUT_TOKENS", usingClaude ? 4000 : 1200),
    inputLimit: envNumber("AI_INPUT_LIMIT", 8000),
    timeoutMs: envNumber("AI_TIMEOUT_MS", usingClaude ? 60000 : 30000),
    store: envBoolean("AI_STORE", false),
    fallbacks: envBoolean("ANTHROPIC_FALLBACKS", true),
    instructions: process.env.AI_INSTRUCTIONS ?? "Be practical, concise, and honest."
  },

  database: databaseConfig(),
  migrations: "database/migrations",
  seeders: "database/seeders",

  cache: {
    driver: process.env.CACHE_DRIVER ?? "memory",
    prefix: process.env.CACHE_PREFIX ?? "noderyx",
    ttl: envNumber("CACHE_TTL", 3600),
    maxItems: envNumber("CACHE_MAX_ITEMS", 512),
    staticMaxAge: envNumber("CACHE_STATIC_MAX_AGE", 86400),
    staleWhileRevalidate: envNumber("CACHE_STALE_WHILE_REVALIDATE", 604800)
  },

  // Configuration is transport-neutral. An email package can consume this block.
  mail: {
    driver: process.env.MAIL_DRIVER ?? "log",
    host: process.env.MAIL_HOST ?? "127.0.0.1",
    port: envNumber("MAIL_PORT", 1025),
    secure: envBoolean("MAIL_SECURE", false),
    username: process.env.MAIL_USERNAME ?? null,
    password: process.env.MAIL_PASSWORD ?? null,
    from: {
      address: process.env.MAIL_FROM_ADDRESS ?? "hello@example.com",
      name: process.env.MAIL_FROM_NAME ?? process.env.APP_NAME ?? "Noderyx"
    }
  },

  security: {
    ...securityProfile(process.env.SECURITY_PROFILE ?? "standard"),
    appKey: process.env.APP_KEY,
    trustProxy: envBoolean("TRUST_PROXY", false),
    bodyLimit: envNumber("REQUEST_BODY_LIMIT", 1048576),
    cors: envList("CORS_ORIGINS"),
    rateLimit: {
      windowMs: envNumber("RATE_LIMIT_WINDOW_MS", 60000),
      max: envNumber("RATE_LIMIT_MAX", 300)
    },
    session: {
      name: process.env.SESSION_COOKIE ?? "noderyx_session",
      maxAge: envNumber("SESSION_MAX_AGE", 604800),
      sameSite: process.env.SESSION_SAME_SITE ?? "Lax",
      secure: envBoolean("SESSION_SECURE", process.env.NODE_ENV === "production")
    }
  },

  mobile: {
    appId: process.env.MOBILE_APP_ID ?? "com.noderyx.demo",
    appName: process.env.MOBILE_APP_NAME ?? "Noderyx",
    views: "resources/views",
    public: "public",
    entry: "home",
    out: "platforms/mobile",
    apiUrl: process.env.MOBILE_API_URL ?? null,
    data: {
      siteName: process.env.SITE_NAME ?? "Noderyx",
      siteUrl: process.env.SITE_URL ?? "https://noderyx.app",
      description: process.env.SITE_DESCRIPTION ?? "Built with Noderyx Framework."
    }
  },

  native: {
    appId: process.env.MOBILE_APP_ID ?? "com.noderyx.demo",
    appName: process.env.MOBILE_APP_NAME ?? "Noderyx",
    views: "resources/mobile",
    out: "platforms/native",
    entry: "home",
    apiUrl: process.env.MOBILE_API_URL ?? null
  }
};
