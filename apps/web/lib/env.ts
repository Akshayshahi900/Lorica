function required(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function requiredUrl(name: string): string {
  const value = required(name);

  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`Environment variable ${name} must be an absolute URL`);
  }
}

function optionalUrl(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;

  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`Environment variable ${name} must be an absolute URL`);
  }
}

export const serverEnv = {
  githubId: required("GITHUB_ID"),
  githubSecret: required("GITHUB_SECRET"),
  apiUrl: requiredUrl("LORICA_API_URL"),
  workerUrl: optionalUrl("LORICA_WORKER_URL"),
  apiToken: process.env.LORICA_API_TOKEN?.trim(),
};
