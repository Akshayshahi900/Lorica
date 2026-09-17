const path = require("path");
const { loadEnvConfig } = require("@next/env");

// Next normally reads environment files from apps/web. The dashboard's
// configuration is intentionally centralized in the repository root instead.
const projectRoot = path.resolve(__dirname, "../..");
loadEnvConfig(projectRoot, process.env.NODE_ENV !== "production");

const requiredVariables = [
  "GITHUB_ID",
  "GITHUB_SECRET",
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "LORICA_API_URL",
  "NEXT_PUBLIC_GITHUB_APP_NAME",
];

for (const name of requiredVariables) {
  if (!process.env[name]?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

if (process.env.NODE_ENV === "production" && !process.env.LORICA_API_TOKEN?.trim()) {
  throw new Error("Missing required environment variable: LORICA_API_TOKEN");
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ["avatars.githubusercontent.com"],
  },
};

module.exports = nextConfig;
