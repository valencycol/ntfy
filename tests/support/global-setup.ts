import { execFileSync } from "node:child_process";

/**
 * Creates the schema in the isolated test D1 and loads the fixture rows, so a
 * run works from a clean checkout with no manual setup. Individual specs
 * reseed the rows themselves; this only has to exist once per run.
 */
export default function globalSetup() {
  const run = (...args: string[]) =>
    execFileSync("npx", ["wrangler", "d1", "execute", "events", "--local", "--persist-to", ".wrangler/test-state", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
      encoding: "utf8",
    });

  try {
    run("--file", "schema.sql");
    run("--file", "tests/seed.sql");
  } catch (error) {
    const details = error instanceof Error && "stderr" in error ? String((error as { stderr: unknown }).stderr) : String(error);
    throw new Error(`Could not prepare the test database:\n${details}`);
  }
}
