import { and, eq, inArray, sql } from "drizzle-orm";
import {
  bookmarksTable,
  hackathonsTable,
  registrationsTable,
  teamMembersTable,
  teamsTable,
  usersTable,
  projectsTable,
} from "@workspace/db";
import { db } from "@workspace/db";
import type { AuthUser } from "../middleware/auth";

export async function formatHackathon(id: number, userId?: number) {
  const [hackathon] = await db
    .select({
      id: hackathonsTable.id,
      title: hackathonsTable.title,
      slug: hackathonsTable.slug,
      description: hackathonsTable.description,
      problemStatement: hackathonsTable.problemStatement,
      category: hackathonsTable.category,
      technologies: hackathonsTable.technologies,
      mode: hackathonsTable.mode,
      location: hackathonsTable.location,
      difficulty: hackathonsTable.difficulty,
      registrationStart: hackathonsTable.registrationStart,
      registrationDeadline: hackathonsTable.registrationDeadline,
      startDate: hackathonsTable.startDate,
      submissionDeadline: hackathonsTable.submissionDeadline,
      prizePool: hackathonsTable.prizePool,
      teamSizeMin: hackathonsTable.teamSizeMin,
      teamSizeMax: hackathonsTable.teamSizeMax,
      eligibility: hackathonsTable.eligibility,
      rules: hackathonsTable.rules,
      faqs: hackathonsTable.faqs,
      coverTone: hackathonsTable.coverTone,
      organizerId: hackathonsTable.organizerId,
      organizerName: usersTable.name,
      organizerAvatarUrl: usersTable.avatarUrl,
      participants: sql<number>`count(distinct ${registrationsTable.id})::int`,
    })
    .from(hackathonsTable)
    .innerJoin(usersTable, eq(usersTable.id, hackathonsTable.organizerId))
    .leftJoin(registrationsTable, and(
      eq(registrationsTable.hackathonId, hackathonsTable.id),
      eq(registrationsTable.status, "REGISTERED"),
    ))
    .where(eq(hackathonsTable.id, id))
    .groupBy(hackathonsTable.id, usersTable.id);

  if (!hackathon) return null;

  const [bookmark] = userId ? await db.select({ id: bookmarksTable.id })
    .from(bookmarksTable)
    .where(and(eq(bookmarksTable.userId, userId), eq(bookmarksTable.hackathonId, id))) : [];
  const [registration] = userId ? await db.select({ id: registrationsTable.id })
    .from(registrationsTable)
    .where(and(eq(registrationsTable.userId, userId), eq(registrationsTable.hackathonId, id), eq(registrationsTable.status, "REGISTERED"))) : [];

  return {
    id: hackathon.id,
    title: hackathon.title,
    slug: hackathon.slug,
    description: hackathon.description,
    problemStatement: hackathon.problemStatement,
    category: hackathon.category,
    technologies: hackathon.technologies,
    mode: hackathon.mode,
    location: hackathon.location,
    difficulty: hackathon.difficulty,
    registrationStart: hackathon.registrationStart.toISOString(),
    registrationDeadline: hackathon.registrationDeadline.toISOString(),
    startDate: hackathon.startDate.toISOString(),
    submissionDeadline: hackathon.submissionDeadline.toISOString(),
    prizePool: hackathon.prizePool,
    teamSizeMin: hackathon.teamSizeMin,
    teamSizeMax: hackathon.teamSizeMax,
    eligibility: hackathon.eligibility,
    rules: hackathon.rules,
    faqs: hackathon.faqs,
    organizer: {
      id: hackathon.organizerId,
      name: hackathon.organizerName,
      avatarUrl: hackathon.organizerAvatarUrl,
    },
    participants: Number(hackathon.participants),
    bookmarked: Boolean(bookmark),
    registered: Boolean(registration),
    coverTone: hackathon.coverTone,
  };
}

export async function formatUser(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return null;
  const completion = [
    user.name,
    user.bio,
    user.skills.length > 0,
    user.interests.length > 0,
    user.githubUrl,
    user.linkedinUrl,
    user.portfolioUrl,
    user.avatarUrl,
  ].filter(Boolean).length;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    bio: user.bio,
    skills: user.skills,
    interests: user.interests,
    avatarUrl: user.avatarUrl,
    profileCompletion: Math.round((completion / 8) * 100),
  };
}

export async function formatTeam(teamId: number) {
  const [team] = await db
    .select({
      id: teamsTable.id,
      name: teamsTable.name,
      description: teamsTable.description,
      hackathonId: teamsTable.hackathonId,
      hackathonTitle: hackathonsTable.title,
      captainId: teamsTable.captainId,
    })
    .from(teamsTable)
    .leftJoin(hackathonsTable, eq(hackathonsTable.id, teamsTable.hackathonId))
    .where(eq(teamsTable.id, teamId));
  if (!team) return null;

  const members = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      role: teamMembersTable.role,
      skills: usersTable.skills,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(teamMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, teamMembersTable.userId))
    .where(eq(teamMembersTable.teamId, teamId));

  return {
    ...team,
    description: team.description,
    members,
    memberCount: members.length,
    maxMembers: 5,
  };
}

export async function formatProject(projectId: number) {
  const [project] = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      description: projectsTable.description,
      githubUrl: projectsTable.githubUrl,
      demoUrl: projectsTable.demoUrl,
      videoUrl: projectsTable.videoUrl,
      technologies: projectsTable.technologies,
      status: projectsTable.status,
      teamId: projectsTable.teamId,
      teamName: teamsTable.name,
      hackathonTitle: hackathonsTable.title,
    })
    .from(projectsTable)
    .leftJoin(teamsTable, eq(teamsTable.id, projectsTable.teamId))
    .leftJoin(hackathonsTable, eq(hackathonsTable.id, teamsTable.hackathonId))
    .where(eq(projectsTable.id, projectId));
  return project ?? null;
}

export async function userTeamIds(userId: number) {
  const rows = await db.select({ teamId: teamMembersTable.teamId })
    .from(teamMembersTable)
    .where(eq(teamMembersTable.userId, userId));
  return rows.map((row) => row.teamId);
}

export async function recommendationRows(user: AuthUser) {
  const [profile] = await db.select({
    skills: usersTable.skills,
    interests: usersTable.interests,
  }).from(usersTable).where(eq(usersTable.id, user.id));
  const rows = await db.select({ id: hackathonsTable.id }).from(hackathonsTable).orderBy(hackathonsTable.registrationDeadline);
  const recommendations = [];
  for (const row of rows) {
    const hackathon = await formatHackathon(row.id, user.id);
    if (!hackathon) continue;
    const skillMatches = profile?.skills.filter((skill) =>
      hackathon.technologies.some((tech) => tech.toLowerCase().includes(skill.toLowerCase()) || skill.toLowerCase().includes(tech.toLowerCase())),
    ).length ?? 0;
    const interestMatch = profile?.interests.some((interest) =>
      `${hackathon.category} ${hackathon.title}`.toLowerCase().includes(interest.toLowerCase()),
    ) ? 1 : 0;
    const score = Math.min(99, 48 + skillMatches * 12 + interestMatch * 15 + (hackathon.mode === "online" ? 5 : 0));
    const reasons = [
      skillMatches > 0 ? `${skillMatches} matching skill${skillMatches === 1 ? "" : "s"}` : "Strong fit for builders",
      interestMatch ? `${hackathon.category} matches your interests` : `${hackathon.difficulty} friendly`,
      hackathon.mode === "online" ? "Online matches your flexibility" : `${hackathon.mode} experience`,
    ];
    recommendations.push({ ...hackathon, score, reasons });
  }
  return recommendations.sort((a, b) => b.score - a.score).slice(0, 6);
}

export async function userCanManageHackathon(user: AuthUser, hackathonId: number) {
  if (user.role === "ADMIN") return true;
  const [hackathon] = await db.select({ organizerId: hackathonsTable.organizerId })
    .from(hackathonsTable).where(eq(hackathonsTable.id, hackathonId));
  return hackathon?.organizerId === user.id;
}

export async function getRegisteredHackathonIds(userId: number) {
  const rows = await db.select({ hackathonId: registrationsTable.hackathonId })
    .from(registrationsTable)
    .where(and(eq(registrationsTable.userId, userId), eq(registrationsTable.status, "REGISTERED")));
  return rows.map((row) => row.hackathonId);
}

export async function getTeamsForUser(userId: number) {
  const ids = await userTeamIds(userId);
  if (!ids.length) return [];
  const rows = await db.select({ id: teamsTable.id }).from(teamsTable).where(inArray(teamsTable.id, ids));
  return Promise.all(rows.map((row) => formatTeam(row.id)));
}