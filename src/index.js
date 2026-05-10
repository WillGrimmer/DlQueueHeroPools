require('dotenv').config();
const express = require('express');
const { InteractionType, InteractionResponseType, verifyKeyMiddleware } = require('discord-interactions');
const db = require('./firebase');
const HEROES = require('./heroes');

const app = express();
const PORT = process.env.PORT || 3000;

// Heroes added before the role feature were stored as plain strings.
// Normalizing on read means all downstream code can assume { name, role } shape.
const normalize = (h) => (typeof h === 'string' ? { name: h, role: null } : h);

const ROLE_EMOJI = { Best: '🟩', Secondary: '🟨' };
const GAME_ROLES = ['Frontline', 'M1', 'Spirit Carry', 'Support', 'Pick'];

// Permission bits used in canViewChannel
const VIEW_CHANNEL = BigInt(0x400);
const ADMINISTRATOR = BigInt(0x8);

// Returns headers for Discord REST calls that require bot authentication
const DISCORD_HEADERS = () => ({
  Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
  'Content-Type': 'application/json',
});

// Deferred response: acknowledge immediately, then edit with measured latency.
// Avoids negative values that occur when comparing against Discord's snowflake
// timestamp, which uses Discord's clock rather than ours.
async function handlePing(interaction, res) {
  const start = Date.now();
  res.json({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: 64 } });
  const latency = Date.now() - start;
  await fetch(
    `https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `🏓 Pong! Latency: **${latency}ms**` }),
    }
  );
}

async function handleAdd(interaction, res) {
  const heroName = interaction.data.options.find((o) => o.name === 'hero')?.value;
  const role = interaction.data.options.find((o) => o.name === 'role')?.value;

  // Options can be absent during an autocomplete interaction that fires before
  // the user has filled in all fields — guard rather than crash
  if (!heroName || !role) {
    return res.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '❌ Please provide both a hero and a role.', flags: 64 },
    });
  }

  // member.user exists in guild contexts; user exists at the top level in DMs
  const userId = interaction.member?.user?.id ?? interaction.user?.id;

  if (!HEROES.includes(heroName)) {
    return res.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `❌ **${heroName}** is not a valid hero.`, flags: 64 },
    });
  }

  const userRef = db.collection('users').doc(userId);
  const doc = await userRef.get();
  const heroes = (doc.exists ? doc.data().heroes ?? [] : []).map(normalize);

  if (heroes.some((h) => h.name === heroName)) {
    return res.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `⚠️ **${heroName}** is already in your pool.`, flags: 64 },
    });
  }

  // merge: true preserves any other fields on the document we don't own
  await userRef.set({ heroes: [...heroes, { name: heroName, role }] }, { merge: true });
  return res.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: `✅ Added **${heroName}** to your pool as **${role}**.`, flags: 64 },
  });
}

async function handleRemove(interaction, res) {
  const heroName = interaction.data.options[0].value;
  const userId = interaction.member?.user?.id ?? interaction.user?.id;

  const userRef = db.collection('users').doc(userId);
  const doc = await userRef.get();
  const heroes = (doc.exists ? doc.data().heroes ?? [] : []).map(normalize);

  if (!heroes.some((h) => h.name === heroName)) {
    return res.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `⚠️ **${heroName}** is not in your pool.`, flags: 64 },
    });
  }

  await userRef.set({ heroes: heroes.filter((h) => h.name !== heroName) }, { merge: true });
  return res.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: `🗑️ Removed **${heroName}** from your pool.`, flags: 64 },
  });
}

// Implements Discord's layered permission resolution:
// base guild perms → @everyone channel overwrite → role overwrites → member overwrite
function canViewChannel(member, channel, guild) {
  if (member.user.id === guild.owner_id) return true;

  const everyoneRole = guild.roles.find((r) => r.id === guild.id);
  let perms = BigInt(everyoneRole?.permissions ?? 0);

  for (const roleId of member.roles) {
    const role = guild.roles.find((r) => r.id === roleId);
    if (role) perms |= BigInt(role.permissions);
  }

  if (perms & ADMINISTRATOR) return true;

  const everyoneOW = channel.permission_overwrites?.find((o) => o.id === guild.id);
  if (everyoneOW) {
    perms &= ~BigInt(everyoneOW.deny);
    perms |= BigInt(everyoneOW.allow);
  }

  let roleAllow = BigInt(0), roleDeny = BigInt(0);
  for (const roleId of member.roles) {
    const ow = channel.permission_overwrites?.find((o) => o.id === roleId);
    if (ow) { roleAllow |= BigInt(ow.allow); roleDeny |= BigInt(ow.deny); }
  }
  perms = (perms & ~roleDeny) | roleAllow;

  const memberOW = channel.permission_overwrites?.find((o) => o.id === member.user.id);
  if (memberOW) {
    perms &= ~BigInt(memberOW.deny);
    perms |= BigInt(memberOW.allow);
  }

  return Boolean(perms & VIEW_CHANNEL);
}

async function handleShowAll(interaction, res) {
  // Defer immediately — fetching members + Firestore takes longer than Discord's 3s limit
  res.json({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: 64 } });

  const { channel_id, guild_id } = interaction;
  const headers = DISCORD_HEADERS();

  // Fetch guild roles, channel overwrites, and member list in parallel
  const [guild, channel, members] = await Promise.all([
    fetch(`https://discord.com/api/v10/guilds/${guild_id}`, { headers }).then((r) => r.json()),
    fetch(`https://discord.com/api/v10/channels/${channel_id}`, { headers }).then((r) => r.json()),
    // 1000 is Discord's maximum per page; sufficient for most servers
    fetch(`https://discord.com/api/v10/guilds/${guild_id}/members?limit=1000`, { headers }).then((r) => r.json()),
  ]);

  const visibleMembers = members.filter(
    (m) => !m.user.bot && canViewChannel(m, channel, guild)
  );

  // Batch all Firestore reads in parallel rather than sequentially
  const docs = await Promise.all(
    visibleMembers.map((m) => db.collection('users').doc(m.user.id).get())
  );

  const lines = [];
  visibleMembers.forEach((member, i) => {
    // Only show Best-role heroes
    const heroes = (docs[i].exists ? docs[i].data().heroes ?? [] : []).map(normalize).filter((h) => h.role === 'Best');
    if (heroes.length === 0) return;

    // Prefer server nickname → display name → username
    const name = member.nick ?? member.user.global_name ?? member.user.username;
    const gameRoles = docs[i].exists ? docs[i].data().gameRoles ?? [] : [];
    const roleTag = gameRoles.length > 0 ? ` [${gameRoles.join(', ')}]` : '';
    const list = heroes.map((h) => `${ROLE_EMOJI[h.role] ?? '⬜'} ${h.name}`).join(', ');
    lines.push(`**${name}${roleTag} (${heroes.length}):** ${list}`);
  });

  const content = lines.length > 0
    ? `\`\`\`\n${lines.join('\n')}\n\`\`\``
    : 'No one in this channel has added any heroes yet.';

  await fetch(
    `https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }
  );
}

async function handleAddRole(interaction, res) {
  const gameRole = interaction.data.options[0].value;
  const userId = interaction.member?.user?.id ?? interaction.user?.id;

  const userRef = db.collection('users').doc(userId);
  const doc = await userRef.get();
  const roles = doc.exists ? doc.data().gameRoles ?? [] : [];

  if (roles.includes(gameRole)) {
    return res.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `⚠️ You already have **${gameRole}** in your roles.`, flags: 64 },
    });
  }

  await userRef.set({ gameRoles: [...roles, gameRole] }, { merge: true });
  return res.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: `✅ Added **${gameRole}** to your roles.`, flags: 64 },
  });
}

async function handleRemoveRole(interaction, res) {
  const gameRole = interaction.data.options[0].value;
  const userId = interaction.member?.user?.id ?? interaction.user?.id;

  const userRef = db.collection('users').doc(userId);
  const doc = await userRef.get();
  const roles = doc.exists ? doc.data().gameRoles ?? [] : [];

  if (!roles.includes(gameRole)) {
    return res.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: `⚠️ **${gameRole}** is not in your roles.`, flags: 64 },
    });
  }

  await userRef.set({ gameRoles: roles.filter((r) => r !== gameRole) }, { merge: true });
  return res.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: `🗑️ Removed **${gameRole}** from your roles.`, flags: 64 },
  });
}

async function handlePool(interaction, res) {
  const targetId = interaction.data.options[0].value;
  // resolved.users is populated by Discord with full user objects for USER-type options
  const targetUser = interaction.data.resolved?.users?.[targetId];
  const username = targetUser?.global_name ?? targetUser?.username ?? `<@${targetId}>`;

  const doc = await db.collection('users').doc(targetId).get();
  const heroes = (doc.exists ? doc.data().heroes ?? [] : []).map(normalize);
  const gameRoles = doc.exists ? doc.data().gameRoles ?? [] : [];

  if (heroes.length === 0 && gameRoles.length === 0) {
    return res.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      // flags: 64 = ephemeral — only the invoking user sees the response
      data: { content: `**${username}** hasn't set up their pool yet.`, flags: 64 },
    });
  }

  const lines = [];
  if (gameRoles.length > 0) lines.push(`**Roles:** ${gameRoles.join(', ')}`);
  if (heroes.length > 0) {
    lines.push(`**Heroes (${heroes.length}):**`);
    heroes.forEach((h) => lines.push(`${ROLE_EMOJI[h.role] ?? '⬜'} ${h.name}`));
  }

  return res.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: `**${username}'s pool:**\n\`\`\`\n${lines.join('\n')}\n\`\`\``, flags: 64 },
  });
}

app.get('/', (_, res) => res.sendStatus(200));

app.post('/interactions', verifyKeyMiddleware(process.env.DISCORD_PUBLIC_KEY), async (req, res) => {
  try {
    const interaction = req.body;

    if (interaction.type === InteractionType.PING) {
      return res.json({ type: InteractionResponseType.PONG });
    }

    // Autocomplete: /add searches the full hero list; /remove searches only the user's current pool
    if (interaction.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
      const focused = interaction.data.options.find((o) => o.focused);
      const query = focused?.value?.toLowerCase() ?? '';
      const userId = interaction.member?.user?.id ?? interaction.user?.id;

      let pool = HEROES;
      if (interaction.data.name === 'remove') {
        const doc = await db.collection('users').doc(userId).get();
        pool = (doc.exists ? doc.data().heroes ?? [] : []).map((h) => normalize(h).name);
      }

      const choices = pool
        .filter((h) => h.toLowerCase().includes(query))
        .slice(0, 25) // Discord caps autocomplete responses at 25 entries
        .map((h) => ({ name: h, value: h }));
      return res.json({ type: 8, data: { choices } });
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      switch (interaction.data.name) {
        case 'ping':        return await handlePing(interaction, res);
        case 'add':         return await handleAdd(interaction, res);
        case 'remove':      return await handleRemove(interaction, res);
        case 'addrole':     return await handleAddRole(interaction, res);
        case 'removerole':  return await handleRemoveRole(interaction, res);
        case 'pool':        return await handlePool(interaction, res);
        case 'showall':     return await handleShowAll(interaction, res);
      }
    }

    return res.status(400).json({ error: 'Unknown interaction type' });
  } catch (err) {
    console.error(err);
    // headersSent guard prevents double-response errors when a handler already replied
    if (!res.headersSent) {
      return res.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: '❌ Something went wrong.', flags: 64 },
      });
    }
  }
});

app.listen(PORT, () => console.log(`Bot listening on port ${PORT}`));
