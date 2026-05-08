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
  const url = DISCORD_GUILD_ID
    ? `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/guilds/${DISCORD_GUILD_ID}/commands`
    : `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    const error = await res.text();
    console.error('Failed to register commands:', error);
    process.exit(1);
  }

  const data = await res.json();
  console.log('Registered commands:', data.map((c) => `/${c.name}`).join(', '));
}

register();
