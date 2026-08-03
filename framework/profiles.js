const PROFILES = Object.freeze({
  saas: {
    label: "SaaS product",
    description: "A scalable subscription product with dashboards, teams, and APIs.",
    cache: { ttl: 900, maxItems: 2048, staticMaxAge: 604800, staleWhileRevalidate: 2592000 },
    security: { bodyLimit: 2097152, rateLimitMax: 600 }
  },
  trading: {
    label: "Trading platform",
    description: "A low-latency trading experience with live market data and secure APIs.",
    cache: { ttl: 30, maxItems: 4096, staticMaxAge: 86400, staleWhileRevalidate: 604800 },
    security: { bodyLimit: 1048576, rateLimitMax: 1200 }
  },
  blog: {
    label: "Blog",
    description: "A fast, search-friendly publication built for articles and media.",
    cache: { ttl: 3600, maxItems: 1024, staticMaxAge: 2592000, staleWhileRevalidate: 604800 },
    security: { bodyLimit: 2097152, rateLimitMax: 300 }
  },
  ecommerce: {
    label: "E-commerce site",
    description: "A conversion-focused storefront with catalog, checkout, and order APIs.",
    cache: { ttl: 300, maxItems: 2048, staticMaxAge: 604800, staleWhileRevalidate: 2592000 },
    security: { bodyLimit: 2097152, rateLimitMax: 600 }
  },
  static: {
    label: "Static site",
    description: "A lightweight static site optimized for global delivery and SEO.",
    cache: { ttl: 86400, maxItems: 512, staticMaxAge: 31536000, staleWhileRevalidate: 2592000 },
    security: { bodyLimit: 262144, rateLimitMax: 200 }
  },
  enterprise: {
    label: "Enterprise solution",
    description: "A secure, high-capacity application for complex teams and integrations.",
    cache: { ttl: 600, maxItems: 8192, staticMaxAge: 604800, staleWhileRevalidate: 2592000 },
    security: { bodyLimit: 4194304, rateLimitMax: 1500 }
  }
});

export const solutionProfiles = Object.freeze(Object.keys(PROFILES));

export function solutionProfile(name = "saas") {
  const normalized = String(name).trim().toLowerCase().replace(/[-_ ]+/g, "");
  const aliases = { softwareasaservice: "saas", shop: "ecommerce", commerce: "ecommerce", corporate: "enterprise" };
  const key = aliases[normalized] ?? normalized;
  const profile = PROFILES[key];
  if (!profile) throw new Error(`Unknown solution profile: ${name}. Choose: ${solutionProfiles.join(", ")}`);
  return { name: key, ...profile, cache: { ...profile.cache }, security: { ...profile.security } };
}
