require('dotenv').config();
const express = require('express');
const { InteractionType, InteractionResponseType, verifyKeyMiddleware } = require('discord-interactions');
const db = require('./firebase');
const HEROES = require('./heroes');

const app = express();
const PORT = process.env.PORT || 3000;

// Heroes added before the role feature were stored as plain strings.
// This converts them to { name, role: null } so all downstream code is uniform.
const normalize = (h) => (typeof h === 'string' ? { name: h, role: null } : h);

// Deferred response: acknowledge immediately, then edit with measured latency.
// This avoids negative values caused by clock skew between Discord's servers and ours.
async function handlePing(interaction, res) {
  const start = Date.now();
  res.json({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });
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

  if (!heroName || !role) {
    return res.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: '❌ Please provide both a hero and a role.', flags: 64 },
    });
  }
  // User ID lives under member.user in guild contexts, user at the top level in DMs
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

  await userRef.set({ heroes: [...heroes, { name: heroName, role }] }, { merge: true });
  return res.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: `✅ Added **${heroName}** to your pool as **${role}**.` },
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
    data: { content: `🗑️ Removed **${heroName}** from your pool.` },
  });
}

async function handlePool(interaction, res) {
  const targetId = interaction.data.options[0].value;
  // resolved.users is populated by Discord with full user objects for USER-type options
  const targetUser = interaction.data.resolved?.users?.[targetId];
  const username = targetUser?.global_name ?? targetUser?.username ?? `<@${targetId}>`;

  const doc = await db.collection('users').doc(targetId).get();
  const heroes = (doc.exists ? doc.data().heroes ?? [] : []).map(normalize);

  if (heroes.length === 0) {
    return res.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      // flags: 64 = ephemeral — only visible to the user who ran the command
      data: { content: `**${username}** hasn't added any heroes to their pool yet.`, flags: 64 },
    });
  }

  const ROLE_EMOJI = { Best: '🟩', Secondary: '🟨' };
  const list = heroes.map((h) => `${ROLE_EMOJI[h.role] ?? '⬜'} ${h.name}`).join('\n');
  return res.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: `**${username}'s hero pool (${heroes.length}):**\n${list}`, flags: 64 },
  });
}

app.post('/interactions', verifyKeyMiddleware(process.env.DISCORD_PUBLIC_KEY), async (req, res) => {
  try {
    const interaction = req.body;

    if (interaction.type === InteractionType.PING) {
      return res.json({ type: InteractionResponseType.PONG });
    }

    // Autocomplete: /add filters the full hero list; /remove filters only the user's current pool
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
        .slice(0, 25) // Discord caps autocomplete at 25 choices
        .map((h) => ({ name: h, value: h }));
      return res.json({ type: 8, data: { choices } });
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      switch (interaction.data.name) {
        case 'ping':   return handlePing(interaction, res);
        case 'add':    return handleAdd(interaction, res);
        case 'remove': return handleRemove(interaction, res);
        case 'pool':   return handlePool(interaction, res);
      }
    }

    return res.status(400).json({ error: 'Unknown interaction type' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      return res.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: '❌ Something went wrong.', flags: 64 },
      });
    }
  }
});

app.listen(PORT, () => console.log(`Bot listening on port ${PORT}`));
