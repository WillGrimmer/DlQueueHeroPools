# DL Hero Pool Bot

A Discord bot for [Deadlock](https://store.steampowered.com/app/1422450/Deadlock/) that lets players manage personal hero pools stored in Firebase Firestore.

## Commands

| Command | Description |
|---|---|
| `/ping` | Check bot latency |
| `/add <hero> <role>` | Add a hero to your pool with a role of Best or Secondary (autocomplete supported) |
| `/remove <hero>` | Remove a hero from your pool (autocomplete supported) |
| `/pool <user>` | View another user's full hero pool (only visible to you) |
| `/showall` | Show everyone's Best heroes in the current channel |

## Hosting (Railway)

The bot is hosted on [Railway](https://railway.app), which keeps the service always-on.

### Deploy to Railway
1. Create a new project at railway.app → **Deploy from GitHub repo**
2. Select this repository
3. Add the following environment variables in the Railway dashboard:

| Variable | Where to find it |
|---|---|
| `DISCORD_PUBLIC_KEY` | Discord Developer Portal → General Information |
| `DISCORD_APPLICATION_ID` | Discord Developer Portal → General Information |
| `DISCORD_BOT_TOKEN` | Discord Developer Portal → Bot → Reset Token |
| `FIREBASE_PROJECT_ID` | Firebase Console → Project Settings → General |
| `FIREBASE_CLIENT_EMAIL` | Firebase Console → Project Settings → Service Accounts → Generate new private key |
| `FIREBASE_PRIVATE_KEY` | Same JSON file as above |

4. Railway auto-detects Node.js and runs `npm start`
5. Copy the generated Railway URL and set it as the **Interactions Endpoint URL** in the Discord Developer Portal:
```
https://<your-railway-url>/interactions
```

### Register slash commands
Run once after any command definition change:
```bash
npm run register
```

## Local Development

```bash
npm install
cp .env.example .env   # fill in values
npm start
ngrok http 3000        # expose locally for testing
```

## Firestore Data Model

```
users/
  {discord_user_id}/
    heroes: { name: string, role: "Best" | "Secondary" }[]
```

## Adding or Updating Heroes

Edit [`src/heroes.js`](src/heroes.js) and restart the bot. The list drives both autocomplete and validation.
