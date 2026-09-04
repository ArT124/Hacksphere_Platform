import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, ilike, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  GetAdminAnalyticsResponse,
  CreateHackathonBody,
  CreateProjectBody,
  CreateTeamBody,
  GetAdminHackathonsResponse,
  GetAdminUsersResponse,
  GetDashboardResponse,
  GetHackathonResponse,
  GetMyProjectsResponse,
  GetMyRegistrationsResponse,
  GetMyTeamsResponse,
  GetNotificationsResponse,
  GetOrganizerDashboardResponse,
  GetProfileResponse,
  GetProjectResponse,
  GetRecommendationsResponse,
  GetTeamResponse,
  GetCurrentUserResponse,
  ListHackathonsResponse,
  LoginBody,
  LoginResponse,
  RegisterBody,
  RegisterResponse,
  UpdateHackathonBody,
  UpdateProfileBody,
  UpdateProjectBody,
} from "@workspace/api-zod";
import {
  bookmarksTable,
  certificatesTable,
  db,
  hackathonsTable,
  notificationsTable,
  projectsTable,
  registrationsTable,
  teamInvitationsTable,
  teamMembersTable,
  teamsTable,
  usersTable,
} from "@workspace/db";
import { createToken, requireAuth, requireRole, optionalAuth } from "../middleware/auth";
import {
  formatHackathon,
  formatProject,
  formatTeam,
  formatUser,
  getRegisteredHackathonIds,
  getTeamsForUser,
  recommendationRows,
  userCanManageHackathon,
  userTeamIds,
} from "../lib/hacksphere";

const router: IRouter = Router();

function idFromParam(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d+$/.test(value)) return null;
  return Number(value);
}

function asError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

async function currentUserResponse(userId: number) {
  const user = await formatUser(userId);
  return user ? GetCurrentUserResponse.parse(user) : null;
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.toLowerCase();
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const [created] = await db.insert(usersTable).values({
    name: parsed.data.name,
    email,
    passwordHash,
    skills: parsed.data.skills ?? [],
    interests: parsed.data.interests ?? [],
  }).returning({ id: usersTable.id });
  const user = await formatUser(created.id);
  if (!user) {
    res.status(500).json({ error: "Unable to create account" });
    return;
  }
  const token = createToken({ id: created.id, name: user.name, email: user.email, role: user.role });
  res.status(201).json(RegisterResponse.parse({ token, user }));
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [userRow] = await db.select().from(usersTable).where(eq(usersTable.email, parsed.data.email.toLowerCase()));
  if (!userRow || !(await bcrypt.compare(parsed.data.password, userRow.passwordHash))) {
    res.status(401).json({ error: "Incorrect email or password" });
    return;
  }
  const user = await formatUser(userRow.id);
  if (!user) {
    res.status(401).json({ error: "Unable to load account" });
    return;
  }
  const token = createToken({ id: user.id, name: user.name, email: user.email, role: user.role });
  res.json(LoginResponse.parse({ token, user }));
});

router.post("/auth/logout", (_req, res) => {
  res.sendStatus(204);
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const user = await currentUserResponse(req.user!.id);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(user);
});

router.get("/hackathons", optionalAuth, async (req, res): Promise<void> => {
  const parsed = (await import("@workspace/api-zod")).ListHackathonsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { search, technology, category, mode, difficulty, page, limit, sort } = parsed.data;
  const filters = [];
  if (search) filters.push(ilike(hackathonsTable.title, `%${search}%`));
  if (category) filters.push(eq(hackathonsTable.category, category));
  if (mode) filters.push(eq(hackathonsTable.mode, mode));
  if (difficulty) filters.push(eq(hackathonsTable.difficulty, difficulty));
  if (technology) filters.push(sql`${technology} = ANY(${hackathonsTable.technologies})`);
  const where = filters.length ? and(...filters) : undefined;
  const order = sort === "popular" ? desc(hackathonsTable.createdAt)
    : sort === "prize" ? desc(hackathonsTable.prizePool)
      : sort === "newest" ? desc(hackathonsTable.createdAt)
        : asc(hackathonsTable.registrationDeadline);
  const [{ total }] = await db.select({ total: count() }).from(hackathonsTable).where(where);
  const rows = await db.select({ id: hackathonsTable.id }).from(hackathonsTable).where(where)
    .orderBy(order).limit(limit).offset((page - 1) * limit);
  const items = (await Promise.all(rows.map((row) => formatHackathon(row.id, req.user?.id)))).filter(Boolean);
  res.json(ListHackathonsResponse.parse({
    items,
    page,
    limit,
    total: Number(total),
    pages: Math.ceil(Number(total) / limit),
  }));
});

router.get("/hackathons/:id", optionalAuth, async (req, res): Promise<void> => {
  const id = idFromParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid hackathon id" });
    return;
  }
  const hackathon = await formatHackathon(id, req.user?.id);
  if (!hackathon) {
    res.status(404).json({ error: "Hackathon not found" });
    return;
  }
  res.json(GetHackathonResponse.parse(hackathon));
});

router.post("/hackathons", requireAuth, requireRole("ORGANIZER", "ADMIN"), async (req, res): Promise<void> => {
  const parsed = CreateHackathonBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  if (data.teamSizeMin > data.teamSizeMax || new Date(data.registrationDeadline) <= new Date(data.registrationStart)) {
    res.status(400).json({ error: "Check team size and registration dates" });
    return;
  }
  const [created] = await db.insert(hackathonsTable).values({
    ...data,
    slug: `${data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
    organizerId: req.user!.id,
    location: data.location || null,
    registrationStart: new Date(data.registrationStart),
    registrationDeadline: new Date(data.registrationDeadline),
    startDate: new Date(data.startDate),
    submissionDeadline: new Date(data.submissionDeadline),
  }).returning({ id: hackathonsTable.id });
  const hackathon = await formatHackathon(created.id, req.user!.id);
  res.status(201).json(GetHackathonResponse.parse(hackathon));
});

router.put("/hackathons/:id", requireAuth, requireRole("ORGANIZER", "ADMIN"), async (req, res): Promise<void> => {
  const id = idFromParam(req.params.id);
  if (!id || !(await userCanManageHackathon(req.user!, id))) {
    res.status(403).json({ error: "You cannot manage this hackathon" });
    return;
  }
  const parsed = UpdateHackathonBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  await db.update(hackathonsTable).set({
    ...data,
    location: data.location || null,
    registrationStart: new Date(data.registrationStart),
    registrationDeadline: new Date(data.registrationDeadline),
    startDate: new Date(data.startDate),
    submissionDeadline: new Date(data.submissionDeadline),
  }).where(eq(hackathonsTable.id, id));
  const hackathon = await formatHackathon(id, req.user!.id);
  res.json(GetHackathonResponse.parse(hackathon));
});

router.delete("/hackathons/:id", requireAuth, requireRole("ORGANIZER", "ADMIN"), async (req, res): Promise<void> => {
  const id = idFromParam(req.params.id);
  if (!id || !(await userCanManageHackathon(req.user!, id))) {
    res.status(403).json({ error: "You cannot manage this hackathon" });
    return;
  }
  await db.delete(hackathonsTable).where(eq(hackathonsTable.id, id));
  res.sendStatus(204);
});

router.post("/hackathons/:id/register", requireAuth, async (req, res): Promise<void> => {
  const hackathonId = idFromParam(req.params.id);
  if (!hackathonId) {
    res.status(400).json({ error: "Invalid hackathon id" });
    return;
  }
  const [hackathon] = await db.select().from(hackathonsTable).where(eq(hackathonsTable.id, hackathonId));
  if (!hackathon) {
    res.status(404).json({ error: "Hackathon not found" });
    return;
  }
  const now = new Date();
  if (now < hackathon.registrationStart || now > hackathon.registrationDeadline) {
    res.status(400).json({ error: "Registration is closed for this hackathon" });
    return;
  }
  const [existing] = await db.select().from(registrationsTable).where(and(
    eq(registrationsTable.userId, req.user!.id),
    eq(registrationsTable.hackathonId, hackathonId),
  ));
  if (existing?.status === "REGISTERED") {
    res.status(409).json({ error: "You are already registered" });
    return;
  }
  const [created] = existing
    ? await db.update(registrationsTable).set({ status: "REGISTERED", createdAt: new Date() }).where(eq(registrationsTable.id, existing.id)).returning()
    : await db.insert(registrationsTable).values({ userId: req.user!.id, hackathonId }).returning();
  const formatted = await formatHackathon(hackathonId, req.user!.id);
  res.status(201).json({
    id: created.id,
    status: created.status,
    createdAt: created.createdAt.toISOString(),
    hackathon: formatted,
  });
});

router.post("/hackathons/:id/bookmark", requireAuth, async (req, res): Promise<void> => {
  const id = idFromParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid hackathon id" });
    return;
  }
  await db.insert(bookmarksTable).values({ userId: req.user!.id, hackathonId: id }).onConflictDoNothing();
  res.sendStatus(204);
});

router.delete("/hackathons/:id/bookmark", requireAuth, async (req, res): Promise<void> => {
  const id = idFromParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid hackathon id" });
    return;
  }
  await db.delete(bookmarksTable).where(and(eq(bookmarksTable.userId, req.user!.id), eq(bookmarksTable.hackathonId, id)));
  res.sendStatus(204);
});

router.get("/users/me/registrations", requireAuth, async (req, res): Promise<void> => {
  const rows = await db.select().from(registrationsTable).where(eq(registrationsTable.userId, req.user!.id)).orderBy(desc(registrationsTable.createdAt));
  const output = [];
  for (const row of rows) {
    const hackathon = await formatHackathon(row.hackathonId, req.user!.id);
    if (hackathon) output.push({ id: row.id, status: row.status, createdAt: row.createdAt.toISOString(), hackathon });
  }
  res.json(GetMyRegistrationsResponse.parse(output));
});

router.delete("/registrations/:id", requireAuth, async (req, res): Promise<void> => {
  const id = idFromParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid registration id" });
    return;
  }
  await db.update(registrationsTable).set({ status: "CANCELLED" }).where(and(eq(registrationsTable.id, id), eq(registrationsTable.userId, req.user!.id)));
  res.sendStatus(204);
});

router.get("/recommendations", requireAuth, async (req, res): Promise<void> => {
  res.json(GetRecommendationsResponse.parse(await recommendationRows(req.user!)));
});

router.get("/dashboard", requireAuth, async (req, res): Promise<void> => {
  const registeredIds = await getRegisteredHackathonIds(req.user!.id);
  const upcoming = (await Promise.all(registeredIds.slice(0, 3).map((id) => formatHackathon(id, req.user!.id)))).filter(Boolean);
  const recommendations = await recommendationRows(req.user!);
  const teams = await getTeamsForUser(req.user!.id);
  const [projectCount] = await db.select({ count: count() }).from(projectsTable).where(and(eq(projectsTable.ownerId, req.user!.id), eq(projectsTable.status, "SUBMITTED")));
  const [certificateCount] = await db.select({ count: count() }).from(certificatesTable).where(eq(certificatesTable.userId, req.user!.id));
  const activity = [
    registeredIds.length ? `Registered for ${upcoming[0]?.title ?? "a hackathon"}` : "Explore a hackathon and start building",
    teams.length ? `Joined Team ${teams[0]?.name}` : "Create a team for your next build",
    Number(projectCount.count) ? `${projectCount.count} project submitted` : "Submit your first project",
  ];
  res.json(GetDashboardResponse.parse({
    registeredHackathons: registeredIds.length,
    activeTeams: teams.length,
    projectsSubmitted: Number(projectCount.count),
    certificates: Number(certificateCount.count),
    upcoming,
    recommendations: recommendations.slice(0, 3),
    activity,
  }));
});

router.get("/teams", requireAuth, async (req, res): Promise<void> => {
  res.json(GetMyTeamsResponse.parse((await getTeamsForUser(req.user!.id)).filter(Boolean)));
});

router.post("/teams", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateTeamBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const created = await db.transaction(async (tx) => {
    const [team] = await tx.insert(teamsTable).values({
      name: parsed.data.name,
      description: parsed.data.description,
      hackathonId: parsed.data.hackathonId ?? null,
      captainId: req.user!.id,
    }).returning({ id: teamsTable.id });
    await tx.insert(teamMembersTable).values({ teamId: team.id, userId: req.user!.id, role: "CAPTAIN" });
    return team;
  });
  res.status(201).json(GetTeamResponse.parse(await formatTeam(created.id)));
});

router.get("/teams/:id", requireAuth, async (req, res): Promise<void> => {
  const id = idFromParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid team id" });
    return;
  }
  const team = await formatTeam(id);
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }
  res.json(GetTeamResponse.parse(team));
});

router.post("/teams/:id/invite", requireAuth, async (req, res): Promise<void> => {
  const teamId = idFromParam(req.params.id);
  const email = typeof req.body.email === "string" ? req.body.email.toLowerCase() : "";
  if (!teamId || !email) {
    res.status(400).json({ error: "A valid team and email are required" });
    return;
  }
  const [team] = await db.select().from(teamsTable).where(and(eq(teamsTable.id, teamId), eq(teamsTable.captainId, req.user!.id)));
  const [invitee] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email));
  if (!team || !invitee) {
    res.status(404).json({ error: "Team or user not found" });
    return;
  }
  await db.insert(teamInvitationsTable).values({ teamId, inviteeId: invitee.id }).onConflictDoNothing();
  await db.insert(notificationsTable).values({ userId: invitee.id, text: `You have been invited to join ${team.name}.` });
  res.status(201).json(null);
});

router.post("/invitations/:id/accept", requireAuth, async (req, res): Promise<void> => {
  const invitationId = idFromParam(req.params.id);
  if (!invitationId) {
    res.status(400).json({ error: "Invalid invitation id" });
    return;
  }
  const [invitation] = await db.select().from(teamInvitationsTable).where(and(eq(teamInvitationsTable.id, invitationId), eq(teamInvitationsTable.inviteeId, req.user!.id)));
  if (!invitation) {
    res.status(404).json({ error: "Invitation not found" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.insert(teamMembersTable).values({ teamId: invitation.teamId, userId: req.user!.id, role: "MEMBER" }).onConflictDoNothing();
    await tx.update(teamInvitationsTable).set({ status: "ACCEPTED" }).where(eq(teamInvitationsTable.id, invitationId));
  });
  res.sendStatus(204);
});

router.get("/projects", requireAuth, async (req, res): Promise<void> => {
  const rows = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.ownerId, req.user!.id)).orderBy(desc(projectsTable.updatedAt));
  res.json(GetMyProjectsResponse.parse((await Promise.all(rows.map((row) => formatProject(row.id)))).filter(Boolean)));
});

router.post("/projects", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.teamId && !(await userTeamIds(req.user!.id)).includes(parsed.data.teamId)) {
    res.status(403).json({ error: "You must belong to the selected team" });
    return;
  }
  const [created] = await db.insert(projectsTable).values({ ...parsed.data, ownerId: req.user!.id }).returning({ id: projectsTable.id });
  res.status(201).json(GetProjectResponse.parse(await formatProject(created.id)));
});

router.get("/projects/:id", requireAuth, async (req, res): Promise<void> => {
  const id = idFromParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const [project] = await db.select({ ownerId: projectsTable.ownerId }).from(projectsTable).where(eq(projectsTable.id, id));
  if (!project || project.ownerId !== req.user!.id) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(GetProjectResponse.parse(await formatProject(id)));
});

router.put("/projects/:id", requireAuth, async (req, res): Promise<void> => {
  const id = idFromParam(req.params.id);
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!id || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid project id" : parsed.error.message });
    return;
  }
  const [updated] = await db.update(projectsTable).set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(projectsTable.id, id), eq(projectsTable.ownerId, req.user!.id))).returning({ id: projectsTable.id });
  if (!updated) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(GetProjectResponse.parse(await formatProject(id)));
});

router.post("/projects/:id/submit", requireAuth, async (req, res): Promise<void> => {
  const id = idFromParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const [project] = await db.select().from(projectsTable).where(and(eq(projectsTable.id, id), eq(projectsTable.ownerId, req.user!.id)));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const teamIds = await userTeamIds(req.user!.id);
  if (!project.teamId || !teamIds.includes(project.teamId)) {
    res.status(400).json({ error: "A project must belong to one of your teams" });
    return;
  }
  const [team] = await db.select({ hackathonId: teamsTable.hackathonId }).from(teamsTable).where(eq(teamsTable.id, project.teamId));
  if (team?.hackathonId) {
    const [hackathon] = await db.select({ submissionDeadline: hackathonsTable.submissionDeadline }).from(hackathonsTable).where(eq(hackathonsTable.id, team.hackathonId));
    if (hackathon && new Date() > hackathon.submissionDeadline) {
      res.status(400).json({ error: "The submission deadline has passed" });
      return;
    }
  }
  await db.update(projectsTable).set({ status: "SUBMITTED", updatedAt: new Date() }).where(eq(projectsTable.id, id));
  res.json(GetProjectResponse.parse(await formatProject(id)));
});

router.get("/profile", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  const projects = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.ownerId, req.user!.id));
  const formatted = await formatUser(req.user!.id);
  res.json(GetProfileResponse.parse({ ...formatted, githubUrl: user.githubUrl, linkedinUrl: user.linkedinUrl, portfolioUrl: user.portfolioUrl, projects: (await Promise.all(projects.map((p) => formatProject(p.id)))).filter(Boolean) }));
});

router.put("/profile", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await db.update(usersTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(usersTable.id, req.user!.id));
  const user = await formatUser(req.user!.id);
  const [raw] = await db.select({ githubUrl: usersTable.githubUrl, linkedinUrl: usersTable.linkedinUrl, portfolioUrl: usersTable.portfolioUrl }).from(usersTable).where(eq(usersTable.id, req.user!.id));
  res.json(GetProfileResponse.parse({ ...user, ...raw, projects: [] }));
});

router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  const rows = await db.select().from(notificationsTable).where(eq(notificationsTable.userId, req.user!.id)).orderBy(desc(notificationsTable.createdAt));
  res.json(GetNotificationsResponse.parse(rows.map((row) => ({ id: row.id, text: row.text, read: row.read, createdAt: row.createdAt.toISOString() }))));
});

router.get("/organizer/dashboard", requireAuth, requireRole("ORGANIZER", "ADMIN"), async (req, res): Promise<void> => {
  const owned = req.user!.role === "ADMIN" ? undefined : eq(hackathonsTable.organizerId, req.user!.id);
  const [hackathonCount] = await db.select({ count: count() }).from(hackathonsTable).where(owned);
  const [registrationCount] = await db.select({ count: count() }).from(registrationsTable).innerJoin(hackathonsTable, eq(hackathonsTable.id, registrationsTable.hackathonId)).where(owned);
  const [teamCount] = await db.select({ count: count() }).from(teamsTable).innerJoin(hackathonsTable, eq(hackathonsTable.id, teamsTable.hackathonId)).where(owned);
  const [projectCount] = await db.select({ count: count() }).from(projectsTable).where(eq(projectsTable.status, "SUBMITTED"));
  const technologyDistribution = [{ name: "React", count: 42 }, { name: "AI", count: 35 }, { name: "TypeScript", count: 28 }, { name: "Python", count: 21 }];
  res.json(GetOrganizerDashboardResponse.parse({
    totalHackathons: Number(hackathonCount.count),
    totalRegistrations: Number(registrationCount.count),
    totalTeams: Number(teamCount.count),
    projectsSubmitted: Number(projectCount.count),
    registrationTrend: [12, 18, 21, 29, 34, 42, 48],
    technologyDistribution,
  }));
});

router.get("/admin/analytics", requireAuth, requireRole("ADMIN"), async (_req, res): Promise<void> => {
  const [users] = await db.select({ count: count() }).from(usersTable);
  const [organizers] = await db.select({ count: count() }).from(usersTable).where(eq(usersTable.role, "ORGANIZER"));
  const [hackathons] = await db.select({ count: count() }).from(hackathonsTable);
  const [registrations] = await db.select({ count: count() }).from(registrationsTable);
  const [projects] = await db.select({ count: count() }).from(projectsTable);
  res.json(GetAdminAnalyticsResponse.parse({
    totalUsers: Number(users.count),
    totalOrganizers: Number(organizers.count),
    totalHackathons: Number(hackathons.count),
    totalRegistrations: Number(registrations.count),
    totalProjects: Number(projects.count),
    activeHackathons: Number(hackathons.count),
  }));
});

router.get("/admin/users", requireAuth, requireRole("ADMIN"), async (_req, res): Promise<void> => {
  const rows = await db.select({ id: usersTable.id }).from(usersTable).orderBy(asc(usersTable.name));
  res.json(GetAdminUsersResponse.parse((await Promise.all(rows.map((row) => formatUser(row.id)))).filter(Boolean)));
});

router.get("/admin/hackathons", requireAuth, requireRole("ADMIN"), async (_req, res): Promise<void> => {
  const rows = await db.select({ id: hackathonsTable.id }).from(hackathonsTable).orderBy(desc(hackathonsTable.createdAt));
  res.json(GetAdminHackathonsResponse.parse((await Promise.all(rows.map((row) => formatHackathon(row.id)))).filter(Boolean)));
});

export default router;