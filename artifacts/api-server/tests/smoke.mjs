import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomInt } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const apiDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceDirectory = path.resolve(apiDirectory, "../..");

const requiredEnvironment = ["DATABASE_URL"];
for (const name of requiredEnvironment) {
  if (!process.env[name]) {
    throw new Error(`${name} must be set before running the HackSphere smoke suite`);
  }
}

const databaseName = `hacksphere_smoke_${process.pid}_${randomInt(100000, 999999)}`;
const testDatabaseUrl = databaseUrlFor(databaseName);
const serverPort = await findFreePort();
const baseUrl = `http://127.0.0.1:${serverPort}/api`;
const serverOutput = [];
let server;
let checks = 0;

function databaseUrlFor(name) {
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

async function runPsql(connectionString, sql) {
  try {
    return await execFileAsync(
      "psql",
      [connectionString, "-v", "ON_ERROR_STOP=1", "-c", sql],
      { maxBuffer: 4 * 1024 * 1024 },
    );
  } catch (error) {
    const stdout = error.stdout ? `\nstdout: ${error.stdout}` : "";
    const stderr = error.stderr ? `\nstderr: ${error.stderr}` : "";
    throw new Error(`PostgreSQL command failed: ${sql}${stdout}${stderr}`, { cause: error });
  }
}

async function createTestDatabase() {
  await runPsql(process.env.DATABASE_URL, `CREATE DATABASE "${databaseName}"`);
  try {
    await execFileAsync(
      "pnpm",
      ["--filter", "@workspace/db", "run", "push-force"],
      {
        cwd: workspaceDirectory,
        env: { ...process.env, DATABASE_URL: testDatabaseUrl },
        maxBuffer: 8 * 1024 * 1024,
      },
    );
  } catch (error) {
    const stdout = error.stdout ? `\nstdout: ${error.stdout}` : "";
    const stderr = error.stderr ? `\nstderr: ${error.stderr}` : "";
    throw new Error(`Unable to apply the database schema for the smoke suite${stdout}${stderr}`, {
      cause: error,
    });
  }
}

async function dropTestDatabase() {
  await runPsql(
    process.env.DATABASE_URL,
    `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
  );
}

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close(() => reject(new Error("Could not determine a free local port")));
        return;
      }
      probe.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function startServer() {
  server = spawn("node", ["--enable-source-maps", "./dist/index.mjs"], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
      PORT: String(serverPort),
      NODE_ENV: "test",
      SESSION_SECRET: process.env.SESSION_SECRET ?? "hacksphere-smoke-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout.on("data", (chunk) => appendServerOutput("stdout", chunk));
  server.stderr.on("data", (chunk) => appendServerOutput("stderr", chunk));

  const started = await waitForServer();
  if (!started) {
    throw new Error(`API server did not become ready${formatServerOutput()}`);
  }
}

function appendServerOutput(stream, chunk) {
  serverOutput.push(`[${stream}] ${String(chunk)}`);
  if (serverOutput.length > 80) serverOutput.shift();
}

function formatServerOutput() {
  return serverOutput.length ? `\n${serverOutput.join("")}` : "";
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) return false;
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return true;
    } catch {
      // The server may still be starting or the port may not be ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      server.kill("SIGKILL");
      resolve();
    }, 5_000);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    server.kill("SIGTERM");
  });
}

async function request(method, route, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${baseUrl}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`${method} ${route} could not reach the API: ${error.message}`, { cause: error });
  }

  const raw = await response.text();
  let parsedBody = null;
  if (raw) {
    try {
      parsedBody = JSON.parse(raw);
    } catch {
      parsedBody = raw;
    }
  }
  return { status: response.status, body: parsedBody };
}

function describeBody(body) {
  if (typeof body === "string") return body;
  return JSON.stringify(body);
}

function expectStatus(response, expected, label) {
  checks += 1;
  if (response.status !== expected) {
    throw new Error(
      `${label}: expected HTTP ${expected}, got ${response.status}; response: ${describeBody(response.body)}`,
    );
  }
}

function expect(condition, label) {
  checks += 1;
  if (!condition) throw new Error(label);
}

async function login(email, password, role) {
  const response = await request("POST", "/auth/login", { body: { email, password } });
  expectStatus(response, 200, `demo login for ${role}`);
  expect(typeof response.body?.token === "string", `demo login for ${role} returned no JWT`);
  expect(response.body?.user?.role === role, `demo login for ${role} returned the wrong role`);

  const currentUser = await request("GET", "/auth/me", { token: response.body.token });
  expectStatus(currentUser, 200, `JWT persistence for ${role}`);
  expect(
    currentUser.body?.email === email && currentUser.body?.role === role,
    `JWT persistence for ${role} returned the wrong user`,
  );
  return response.body.token;
}

async function runSmokeSuite() {
  const health = await request("GET", "/healthz");
  expectStatus(health, 200, "health check");
  expect(health.body?.status === "ok", "health check returned an unexpected body");

  const unauthenticated = await request("GET", "/auth/me");
  expectStatus(unauthenticated, 401, "protected current-user route without a token");
  expect(
    unauthenticated.body?.error === "Authentication required",
    "protected current-user route did not explain the missing authentication",
  );

  const userToken = await login("user@hacksphere.dev", "User@123", "USER");
  const organizerToken = await login(
    "organizer@hacksphere.dev",
    "Organizer@123",
    "ORGANIZER",
  );
  const adminToken = await login("admin@hacksphere.dev", "Admin@123", "ADMIN");

  const uniqueEmail = `smoke-${Date.now()}-${process.pid}@example.com`;
  const registration = await request("POST", "/auth/register", {
    body: {
      name: "Smoke Test Builder",
      email: uniqueEmail,
      password: "SmokeTest@123",
      skills: ["TypeScript", "React"],
      interests: ["AI", "Climate"],
    },
  });
  expectStatus(registration, 201, "new account registration");
  expect(typeof registration.body?.token === "string", "new account registration returned no JWT");
  expect(
    registration.body?.user?.email === uniqueEmail && registration.body?.user?.role === "USER",
    "new account registration returned incorrect user data",
  );
  const newUserToken = registration.body.token;

  const filteredHackathons = await request(
    "GET",
    "/hackathons?technology=React&category=AI&mode=hybrid&difficulty=advanced&sort=prize&limit=50",
  );
  expectStatus(filteredHackathons, 200, "hackathon discovery filters");
  expect(filteredHackathons.body?.items?.length === 1, "hackathon discovery filters returned an unexpected result count");
  const hackathon = filteredHackathons.body.items[0];
  expect(
    hackathon.title === "AI Nexus Challenge" &&
      hackathon.category === "AI" &&
      hackathon.mode === "hybrid" &&
      hackathon.difficulty === "advanced" &&
      hackathon.technologies.includes("React"),
    "hackathon discovery filters returned a non-matching hackathon",
  );

  const recommendations = await request("GET", "/recommendations", { token: newUserToken });
  expectStatus(recommendations, 200, "personalized recommendations");
  expect(Array.isArray(recommendations.body) && recommendations.body.length > 0, "recommendations returned no opportunities");
  expect(
    recommendations.body.every(
      (item) => Number.isInteger(item.score) && Array.isArray(item.reasons) && item.reasons.length > 0,
    ),
    "recommendations did not include explainable scores and reasons",
  );

  const createdRegistration = await request(
    "POST",
    `/hackathons/${hackathon.id}/register`,
    { token: newUserToken },
  );
  expectStatus(createdRegistration, 201, "hackathon registration");
  expect(
    createdRegistration.body?.status === "REGISTERED" &&
      createdRegistration.body?.hackathon?.id === hackathon.id,
    "hackathon registration returned incorrect registration data",
  );

  const myRegistrations = await request("GET", "/users/me/registrations", { token: newUserToken });
  expectStatus(myRegistrations, 200, "list of registered hackathons");
  expect(
    myRegistrations.body?.some((item) => item.hackathon?.id === hackathon.id && item.status === "REGISTERED"),
    "new registration was not present in the current user's registrations",
  );

  const createdTeam = await request("POST", "/teams", {
    token: newUserToken,
    body: {
      name: `Smoke Team ${process.pid}`,
      description: "A temporary team for the release smoke journey.",
      hackathonId: hackathon.id,
    },
  });
  expectStatus(createdTeam, 201, "team creation");
  expect(
    Number.isInteger(createdTeam.body?.id) &&
      createdTeam.body?.captainId === registration.body.user.id &&
      createdTeam.body?.members?.some((member) => member.role === "CAPTAIN"),
    "team creation did not make the registering user captain",
  );

  const createdProject = await request("POST", "/projects", {
    token: newUserToken,
    body: {
      name: "Smoke Submission",
      description: "A temporary project covering the submission journey.",
      githubUrl: "https://github.com/hacksphere/smoke-submission",
      technologies: ["TypeScript", "React"],
      teamId: createdTeam.body.id,
    },
  });
  expectStatus(createdProject, 201, "project creation");
  expect(
    createdProject.body?.status === "DRAFT" && createdProject.body?.teamId === createdTeam.body.id,
    "project creation returned an invalid draft",
  );

  const submittedProject = await request(
    "POST",
    `/projects/${createdProject.body.id}/submit`,
    { token: newUserToken },
  );
  expectStatus(submittedProject, 200, "project submission");
  expect(submittedProject.body?.status === "SUBMITTED", "project submission did not change project status");

  const organizerOnlyPayload = {
    title: `Smoke Authorization ${process.pid}`,
    description: "A temporary hackathon used to verify organizer authorization.",
    problemStatement: "A temporary problem statement for the authorization smoke check.",
    category: "Testing",
    technologies: ["TypeScript"],
    mode: "online",
    difficulty: "beginner",
    registrationStart: new Date(Date.now() - 60_000).toISOString(),
    registrationDeadline: new Date(Date.now() + 86_400_000).toISOString(),
    startDate: new Date(Date.now() + 172_800_000).toISOString(),
    submissionDeadline: new Date(Date.now() + 259_200_000).toISOString(),
    prizePool: 0,
    teamSizeMin: 1,
    teamSizeMax: 4,
    eligibility: "Smoke test participants",
    rules: "Use this event only for the release smoke suite.",
    faqs: ["Is this temporary?"],
  };

  const userCreateHackathon = await request("POST", "/hackathons", {
    token: userToken,
    body: organizerOnlyPayload,
  });
  expectStatus(userCreateHackathon, 403, "USER blocked from creating hackathons");
  const organizerCreateHackathon = await request("POST", "/hackathons", {
    token: organizerToken,
    body: organizerOnlyPayload,
  });
  expectStatus(organizerCreateHackathon, 201, "ORGANIZER creating a hackathon");

  const userOrganizerDashboard = await request("GET", "/organizer/dashboard", { token: userToken });
  expectStatus(userOrganizerDashboard, 403, "USER blocked from organizer dashboard");
  const organizerDashboard = await request("GET", "/organizer/dashboard", { token: organizerToken });
  expectStatus(organizerDashboard, 200, "ORGANIZER organizer dashboard");
  expect(
    Number.isInteger(organizerDashboard.body?.totalHackathons),
    "organizer dashboard returned an invalid summary",
  );
  const adminOrganizerDashboard = await request("GET", "/organizer/dashboard", { token: adminToken });
  expectStatus(adminOrganizerDashboard, 200, "ADMIN organizer dashboard access");

  const organizerAdminAnalytics = await request("GET", "/admin/analytics", {
    token: organizerToken,
  });
  expectStatus(organizerAdminAnalytics, 403, "ORGANIZER blocked from admin analytics");
  const adminAnalytics = await request("GET", "/admin/analytics", { token: adminToken });
  expectStatus(adminAnalytics, 200, "ADMIN admin analytics");
  expect(
    Number.isInteger(adminAnalytics.body?.totalUsers) &&
      Number.isInteger(adminAnalytics.body?.totalHackathons),
    "admin analytics returned an invalid summary",
  );
  const adminUsers = await request("GET", "/admin/users", { token: adminToken });
  expectStatus(adminUsers, 200, "ADMIN user management access");
  const adminHackathons = await request("GET", "/admin/hackathons", { token: adminToken });
  expectStatus(adminHackathons, 200, "ADMIN hackathon management access");
}

try {
  process.stdout.write(`Preparing isolated smoke database ${databaseName}...\n`);
  await createTestDatabase();
  await startServer();
  await runSmokeSuite();
  process.stdout.write(`HackSphere API smoke suite passed (${checks} checks).\n`);
} catch (error) {
  process.stderr.write(`HackSphere API smoke suite failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await stopServer();
  try {
    await dropTestDatabase();
  } catch (error) {
    process.stderr.write(`Warning: unable to drop isolated smoke database: ${error.message}\n`);
    process.exitCode = 1;
  }
}