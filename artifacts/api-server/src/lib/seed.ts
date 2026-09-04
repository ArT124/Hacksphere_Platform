import bcrypt from "bcryptjs";
import { count } from "drizzle-orm";
import {
  bookmarksTable,
  certificatesTable,
  db,
  hackathonsTable,
  notificationsTable,
  projectsTable,
  registrationsTable,
  teamMembersTable,
  teamsTable,
  usersTable,
} from "@workspace/db";

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000);

export async function seedDatabase(): Promise<void> {
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  if (existing) {
    await ensureDemoMinimums();
    return;
  }

  const passwordHash = await bcrypt.hash("User@123", 10);
  const [user, organizer, admin, ...others] = await db.insert(usersTable).values([
    { name: "Anushka Dixit", email: "user@hacksphere.dev", passwordHash, role: "USER", bio: "Frontend developer turning ambitious ideas into useful products.", skills: ["React", "TypeScript", "UI/UX"], interests: ["AI", "Climate", "Education"] },
    { name: "Maya Chen", email: "organizer@hacksphere.dev", passwordHash: await bcrypt.hash("Organizer@123", 10), role: "ORGANIZER", bio: "Building communities around technology for good.", skills: ["Product", "AI", "Community"], interests: ["AI", "Fintech", "Climate"] },
    { name: "Arjun Mehta", email: "admin@hacksphere.dev", passwordHash: await bcrypt.hash("Admin@123", 10), role: "ADMIN", bio: "Platform administrator.", skills: ["Operations", "Security"], interests: ["Open Source"] },
    ...[
      ["Rahul Sharma", "rahul@hacksphere.dev", ["Python", "FastAPI"], ["AI", "Cloud"]],
      ["Priya Nair", "priya@hacksphere.dev", ["Figma", "UX Research"], ["Health", "Education"]],
      ["Dev Patel", "dev@hacksphere.dev", ["Node.js", "PostgreSQL"], ["Fintech", "Open Source"]],
      ["Sana Kapoor", "sana@hacksphere.dev", ["React Native", "Expo"], ["Climate", "Health"]],
      ["Kabir Joshi", "kabir@hacksphere.dev", ["Go", "Kubernetes"], ["Cloud", "Security"]],
      ["Ishita Rao", "ishita@hacksphere.dev", ["Solidity", "React"], ["Blockchain", "Fintech"]],
      ["Aarav Singh", "aarav@hacksphere.dev", ["Java", "Spring"], ["Smart City", "Education"]],
      ["Meera Iyer", "meera@hacksphere.dev", ["Data Science", "Python"], ["AI", "Health"]],
      ["Zoya Khan", "zoya@hacksphere.dev", ["Vue", "TypeScript"], ["Climate", "Open Source"]],
      ["Rohan Gupta", "rohan@hacksphere.dev", ["AWS", "Terraform"], ["Cloud", "Security"]],
      ["Nisha Verma", "nisha@hacksphere.dev", ["Content", "Research"], ["Education", "Health"]],
      ["Aditya Bose", "aditya@hacksphere.dev", ["Rust", "WebAssembly"], ["Open Source", "AI"]],
      ["Tanya Das", "tanya@hacksphere.dev", ["Flutter", "Dart"], ["Health", "Smart City"]],
      ["Vikram Shah", "vikram@hacksphere.dev", ["Cybersecurity", "Linux"], ["Security", "Cloud"]],
      ["Lavanya Sen", "lavanya@hacksphere.dev", ["Next.js", "GraphQL"], ["Fintech", "AI"]],
      ["Neil Thomas", "neil@hacksphere.dev", ["Svelte", "CSS"], ["Climate", "Education"]],
    ].map(([name, email, skills, interests]) => ({
      name: name as string,
      email: email as string,
      passwordHash,
      role: "USER" as const,
      bio: "Hackathon builder and lifelong learner.",
      skills: skills as string[],
      interests: interests as string[],
    })),
  ]).returning();

  const eventNames = [
    ["AI Nexus Challenge", "AI", ["AI", "Python", "React"], "advanced", "violet"],
    ["Tech for Good Hackathon", "Social Impact", ["React", "Node.js", "PostgreSQL"], "beginner", "teal"],
    ["Cloud Innovators Challenge", "Cloud", ["AWS", "Kubernetes", "Go"], "intermediate", "blue"],
    ["Full Stack Forge", "Web Development", ["TypeScript", "React", "Node.js"], "intermediate", "orange"],
    ["GreenTech Buildathon", "Climate", ["IoT", "Python", "React Native"], "beginner", "emerald"],
    ["FinTech Revolution", "Fintech", ["Next.js", "GraphQL", "PostgreSQL"], "advanced", "amber"],
    ["CyberShield Hackathon", "Security", ["Cybersecurity", "Linux", "Go"], "advanced", "rose"],
    ["Open Source Sprint", "Open Source", ["Rust", "WebAssembly", "TypeScript"], "intermediate", "indigo"],
    ["GenAI Builders Challenge", "AI", ["LLMs", "Python", "React"], "intermediate", "fuchsia"],
    ["Smart City Hackathon", "Smart City", ["IoT", "Flutter", "AWS"], "beginner", "cyan"],
    ["Women in Tech Buildathon", "Community", ["React", "Figma", "Node.js"], "beginner", "pink"],
    ["Blockchain Innovation Challenge", "Blockchain", ["Solidity", "React", "Node.js"], "advanced", "slate"],
    ["HealthTech Hackathon", "Health", ["Python", "Data Science", "React Native"], "intermediate", "lime"],
    ["EduTech Challenge", "Education", ["Vue", "TypeScript", "PostgreSQL"], "beginner", "sky"],
    ["ClimateTech Sprint", "Climate", ["Python", "Data Science", "IoT"], "intermediate", "green"],
  ] as const;

  const eventRows = eventNames.map(([title, category, technologies, difficulty, coverTone], index) => ({
    title,
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    description: `Build a thoughtful solution for the ${category.toLowerCase()} challenges shaping our future.`,
    problemStatement: `How might we make ${category.toLowerCase()} more accessible, useful, and human for everyone?`,
    category,
    technologies: [...technologies],
    mode: index % 4 === 0 ? "hybrid" as const : "online" as const,
    location: index % 4 === 0 ? "Bengaluru, India" : null,
    difficulty,
    registrationStart: daysFromNow(-10),
    registrationDeadline: daysFromNow(8 + (index % 10)),
    startDate: daysFromNow(12 + (index % 10)),
    submissionDeadline: daysFromNow(14 + (index % 10)),
    prizePool: 5000 + index * 1250,
    teamSizeMin: 1,
    teamSizeMax: 4 + (index % 2),
    eligibility: "Open to developers, designers, students, and curious builders worldwide.",
    rules: "Build original work during the event window. Be kind, cite your sources, and share what you learned.",
    faqs: ["Can I participate solo?", "Is this event free?", "How are projects judged?"],
    organizerId: organizer.id,
    coverTone,
  }));
  const events = await db.insert(hackathonsTable).values(eventRows).returning();

  const registrations = [
    ...others.slice(0, 12).map((participant, index) => ({ userId: participant.id, hackathonId: events[index % events.length].id })),
    ...others.slice(5, 15).map((participant, index) => ({ userId: participant.id, hackathonId: events[(index + 3) % events.length].id })),
    { userId: user.id, hackathonId: events[0].id },
    { userId: user.id, hackathonId: events[3].id },
  ];
  await db.insert(registrationsTable).values(registrations).onConflictDoNothing();

  const teamRows = await db.insert(teamsTable).values([
    { name: "CodeStorm", description: "Fast-moving builders exploring practical AI.", hackathonId: events[0].id, captainId: user.id },
    { name: "Green Byte", description: "Making climate data feel actionable.", hackathonId: events[4].id, captainId: others[2].id },
    { name: "Pixel Pioneers", description: "Design-led products for real people.", hackathonId: events[1].id, captainId: others[1].id },
    { name: "Stack Foundry", description: "Shipping reliable developer tools.", hackathonId: events[3].id, captainId: others[3].id },
    { name: "Cloud Nine", description: "Infrastructure with a human touch.", hackathonId: events[2].id, captainId: others[4].id },
    { name: "Open Builders", description: "Small experiments, shared openly.", hackathonId: events[7].id, captainId: others[5].id },
    { name: "Health Hackers", description: "Better tools for healthier communities.", hackathonId: events[12].id, captainId: others[6].id },
    { name: "Civic Loop", description: "Technology for more livable cities.", hackathonId: events[9].id, captainId: others[7].id },
    { name: "Fintech Folk", description: "Making finance more inclusive.", hackathonId: events[5].id, captainId: others[8].id },
    { name: "Shield Squad", description: "Security minded from day one.", hackathonId: events[6].id, captainId: others[9].id },
  ]).returning();

  await db.insert(teamMembersTable).values(teamRows.flatMap((team, index) => [
    { teamId: team.id, userId: team.captainId, role: "CAPTAIN" as const },
    ...(others[index] ? [{ teamId: team.id, userId: others[index].id, role: "MEMBER" as const }] : []),
  ])).onConflictDoNothing();

  await db.insert(projectsTable).values([
    { name: "SmartAssist", description: "A friendly AI copilot that turns complex workflows into clear next steps.", githubUrl: "https://github.com/hacksphere/smart-assist", demoUrl: "https://smartassist.demo.hacksphere.dev", technologies: ["React", "Python", "AI"], teamId: teamRows[0].id, ownerId: user.id, status: "SUBMITTED" },
    { name: "Carbon Lens", description: "A visual way for small teams to understand their footprint.", githubUrl: "https://github.com/hacksphere/carbon-lens", demoUrl: "https://carbon-lens.demo.hacksphere.dev", technologies: ["React Native", "IoT"], teamId: teamRows[1].id, ownerId: others[2].id, status: "SUBMITTED" },
    { name: "Civic Pulse", description: "Community signals for better city decisions.", githubUrl: "https://github.com/hacksphere/civic-pulse", technologies: ["TypeScript", "PostgreSQL"], teamId: teamRows[7].id, ownerId: others[7].id, status: "DRAFT" },
    { name: "Open Care", description: "A low-friction care coordination workspace.", githubUrl: "https://github.com/hacksphere/open-care", technologies: ["Python", "React"], teamId: teamRows[6].id, ownerId: others[6].id, status: "SUBMITTED" },
  ]);

  await db.insert(bookmarksTable).values([
    { userId: user.id, hackathonId: events[1].id },
    { userId: user.id, hackathonId: events[4].id },
    { userId: user.id, hackathonId: events[8].id },
  ]).onConflictDoNothing();

  await db.insert(notificationsTable).values([
    { userId: user.id, text: "Your registration for AI Nexus Challenge was successful." },
    { userId: user.id, text: "You have been invited to join CodeStorm." },
    { userId: user.id, text: "Submission deadline is approaching for Full Stack Forge." },
    { userId: organizer.id, text: "Your next hackathon has 48 new registrations." },
  ]);

  void admin;
  await ensureDemoMinimums();
}

async function ensureDemoMinimums(): Promise<void> {
  const minimumPasswordHash = await bcrypt.hash("User@123", 10);
  await db.insert(usersTable).values({
    name: "Karan Malhotra",
    email: "karan@hacksphere.dev",
    passwordHash: minimumPasswordHash,
    role: "USER",
    bio: "Builder looking for the next interesting problem.",
    skills: ["JavaScript", "React"],
    interests: ["AI", "Open Source"],
  }).onConflictDoNothing();

  const allUsers = await db.select({ id: usersTable.id }).from(usersTable).orderBy(usersTable.id);
  const allEvents = await db.select({ id: hackathonsTable.id }).from(hackathonsTable).orderBy(hackathonsTable.id);
  const [registrationTotal] = await db.select({ count: count() }).from(registrationsTable);
  if (Number(registrationTotal.count) < 30) {
    const pairs = [];
    for (const person of allUsers) {
      for (const event of allEvents) {
        pairs.push({ userId: person.id, hackathonId: event.id });
        if (pairs.length >= 40) break;
      }
      if (pairs.length >= 40) break;
    }
    await db.insert(registrationsTable).values(pairs).onConflictDoNothing();
  }

  const [projectTotal] = await db.select({ count: count() }).from(projectsTable);
  if (Number(projectTotal.count) < 8) {
    const allTeams = await db.select({ id: teamsTable.id, captainId: teamsTable.captainId }).from(teamsTable).orderBy(teamsTable.id);
    const projectRows = allTeams.slice(0, 8).map((team, index) => ({
      name: ["Signal Garden", "Route Zero", "Care Loop", "Ledger Light", "Watermark", "Study Buddy", "Safe Harbor", "Local Lens"][index],
      description: "A demo project created by builders in the HackSphere community.",
      githubUrl: `https://github.com/hacksphere/demo-${index + 1}`,
      technologies: ["React", "TypeScript"],
      teamId: team.id,
      ownerId: team.captainId,
      status: index % 2 === 0 ? "SUBMITTED" as const : "DRAFT" as const,
    }));
    await db.insert(projectsTable).values(projectRows);
  }

  const [certificateTotal] = await db.select({ count: count() }).from(certificatesTable);
  if (Number(certificateTotal.count) === 0 && allUsers[0] && allEvents[0]) {
    await db.insert(certificatesTable).values([
      { userId: allUsers[0].id, hackathonId: allEvents[0].id, issuedAt: "2026-08-20" },
      { userId: allUsers[0].id, hackathonId: allEvents[Math.min(1, allEvents.length - 1)].id, issuedAt: "2026-08-27" },
    ]);
  }
}