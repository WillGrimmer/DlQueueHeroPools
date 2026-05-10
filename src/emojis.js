// Fetches application emojis once at startup and provides a hero name → <:name:id> lookup.
// Application emojis are only usable by the bot that owns them.

// Heroes whose names don't normalize cleanly to their uploaded emoji name
const OVERRIDES = {
  'The Doorman': 'doorman',
  'Mo & Krill': 'moandkrill',
};

const heroEmojiMap = new Map();

async function loadEmojis() {
  const res = await fetch(
    `https://discord.com/api/v10/applications/${process.env.DISCORD_APPLICATION_ID}/emojis`,
    { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
  );
  const { items } = await res.json();
  items.forEach((e) => heroEmojiMap.set(e.name, `<:${e.name}:${e.id}>`));
  console.log(`Loaded ${items.length} application emojis`);
}

// Returns the Discord emoji string for a hero, or empty string if not found.
function heroEmoji(heroName) {
  const key = OVERRIDES[heroName] ?? heroName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return heroEmojiMap.get(key) ?? '';
}

module.exports = { loadEmojis, heroEmoji };
