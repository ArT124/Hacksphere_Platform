import {
  boolean,
  date,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["USER", "ORGANIZER", "ADMIN"]);
export const modeEnum = pgEnum("hackathon_mode", ["online", "offline", "hybrid"]);
export const difficultyEnum = pgEnum("difficulty", ["beginner", "intermediate", "advanced"]);
export const registrationStatusEnum = pgEnum("registration_status", ["REGISTERED", "CANCELLED", "COMPLETED"]);
export const teamRoleEnum = pgEnum("team_role", ["CAPTAIN", "MEMBER"]);
export const projectStatusEnum = pgEnum("project_status", ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "EVALUATED"]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("USER"),
  bio: text("bio").notNull().default(""),
  skills: text("skills").array().notNull().default([]),
  interests: text("interests").array().notNull().default([]),
  avatarUrl: text("avatar_url"),
  githubUrl: text("github_url"),
  linkedinUrl: text("linkedin_url"),
  portfolioUrl: text("portfolio_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const skillsTable = pgTable("skills", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const hackathonsTable = pgTable("hackathons", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull(),
  problemStatement: text("problem_statement").notNull(),
  category: text("category").notNull(),
  technologies: text("technologies").array().notNull().default([]),
  mode: modeEnum("mode").notNull(),
  location: text("location"),
  difficulty: difficultyEnum("difficulty").notNull(),
  registrationStart: timestamp("registration_start", { withTimezone: true }).notNull(),
  registrationDeadline: timestamp("registration_deadline", { withTimezone: true }).notNull(),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  submissionDeadline: timestamp("submission_deadline", { withTimezone: true }).notNull(),
  prizePool: integer("prize_pool").notNull().default(0),
  teamSizeMin: integer("team_size_min").notNull().default(1),
  teamSizeMax: integer("team_size_max").notNull().default(4),
  eligibility: text("eligibility").notNull().default("Open to all developers"),
  rules: text("rules").notNull().default("Build something original and have fun."),
  faqs: text("faqs").array().notNull().default([]),
  organizerId: integer("organizer_id").notNull().references(() => usersTable.id),
  coverTone: text("cover_tone").notNull().default("violet"),
  status: text("status").notNull().default("APPROVED"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const registrationsTable = pgTable("registrations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  hackathonId: integer("hackathon_id").notNull().references(() => hackathonsTable.id, { onDelete: "cascade" }),
  status: registrationStatusEnum("status").notNull().default("REGISTERED"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userHackathonUnique: unique("registrations_user_hackathon_unique").on(table.userId, table.hackathonId),
}));

export const teamsTable = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  hackathonId: integer("hackathon_id").references(() => hackathonsTable.id, { onDelete: "set null" }),
  captainId: integer("captain_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teamMembersTable = pgTable("team_members", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teamsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  role: teamRoleEnum("role").notNull().default("MEMBER"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  teamUserUnique: unique("team_members_team_user_unique").on(table.teamId, table.userId),
}));

export const teamInvitationsTable = pgTable("team_invitations", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teamsTable.id, { onDelete: "cascade" }),
  inviteeId: integer("invitee_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  githubUrl: text("github_url"),
  demoUrl: text("demo_url"),
  videoUrl: text("video_url"),
  technologies: text("technologies").array().notNull().default([]),
  status: projectStatusEnum("status").notNull().default("DRAFT"),
  teamId: integer("team_id").references(() => teamsTable.id, { onDelete: "set null" }),
  ownerId: integer("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bookmarksTable = pgTable("bookmarks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  hackathonId: integer("hackathon_id").notNull().references(() => hackathonsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userHackathonUnique: unique("bookmarks_user_hackathon_unique").on(table.userId, table.hackathonId),
}));

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const certificatesTable = pgTable("certificates", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  hackathonId: integer("hackathon_id").notNull().references(() => hackathonsTable.id, { onDelete: "cascade" }),
  issuedAt: date("issued_at", { mode: "string" }).notNull(),
});