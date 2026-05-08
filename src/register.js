require('dotenv').config();

const { DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID } = process.env;

if (!DISCORD_BOT_TOKEN || !DISCORD_APPLICATION_ID) {
  console.error('Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID in .env');
  process.exit(1);
}

const commands = [
  {
    name: 'ping',
    description: 'Check bot latency',
  },
  {
    name: 'add',
    description: 'Add a hero to your pool',
    options: [
      {
        name: 'hero',
        description: 'Hero name',
        type: 3, // STRING
        required: true,
        autocomplete: true,
      },
      {
        name: 'role',
        description: 'Your level with this hero',
        type: 3, // STRING
        required: true,
        choices: [
          { name: 'Best', value: 'Best' },
          { name: 'Secondary', value: 'Secondary' },
        ],
      },
    ],
  },
  {
    name: 'remove',
    description: 'Remove a hero from your pool',
    options: [
      {
        name: 'hero',
        description: 'Hero name',
        type: 3, // STRING
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: 'showall',
    description: 'Show hero pools for all non-bot members who can see this channel',
  },
  {
    name: 'pool',
    description: "View a user's hero pool",
    options: [
      {
        name: 'user',
        description: 'The user to look up',
        type: 6, // USER
        required: true,
      },
    ],
  },
];

async function register() {
  const globalUrl = `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`;
  const headers = { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' };

  // Clear guild-specific commands first to avoid duplicates showing in the original server
  if (DISCORD_GUILD_ID) {
    await fetch(
      `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/guilds/${DISCORD_GUILD_ID}/commands`,
      { method: 'PUT', headers, body: '[]' }
    );
    console.log('Cleared guild commands');
  }

  // Register globally so commands appear in every server the bot is invited to
  const res = await fetch(globalUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    const error = await res.text();
    console.error('Failed to register commands:', error);
    process.exit(1);
  }

  const data = await res.json();
  console.log('Registered global commands:', data.map((c) => `/${c.name}`).join(', '));
  console.log('Note: global commands can take up to 1 hour to appear in all servers.');
}

register();
