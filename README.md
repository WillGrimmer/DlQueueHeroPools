# DL Hero Pool Bot

A Discord bot for [Deadlock](https://store.steampowered.com/app/1422450/Deadlock/) that lets players manage personal hero pools stored in Firebase Firestore.

## Commands

| Command | Description |
|---|---|
| `/ping` | Check bot latency |
| `/add <hero>` | Add a hero to your pool (autocomplete supported) |
| `/remove <hero>` | Remove a hero from your pool (autocomplete supported) |
| `/pool <user>` | View another user's hero pool (only visible to you) |

## Setup

### Prerequisites
- Node.js 18+
- [ngrok](https://ngrok.com/) (or another tunnel for local hosting)
- A [Discord Application](https://discord.com/developers/applications) with a bot token
- A [Firebase](https://console.firebase.google.com/) project with Firestore enabled

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment variables
Copy `.env.example` to `.env` and fill in all values:

```bash
cp .env.example .env
```

| Variable | Where to find it |
|---|---|
| `DISCORD_PUBLIC_KEY` | Discord Developer Portal → General Information |
| `DISCORD_APPLICATION_ID` | Discord Developer Portal → General Information |
| `DISCORD_BOT_TOKEN` | Discord Developer Portal → Bot → Reset Token |
| `DISCORD_GUILD_ID` | Right-click your server in Discord → Copy Server ID (requires Developer Mode) |
| `FIREBASE_PROJECT_ID` | Firebase Console → Project Settings → General |
| `FIREBASE_CLIENT_EMAIL` | Firebase Console → Project Settings → Service Accounts → Generate new private key |
| `FIREBASE_PRIVATE_KEY` | Same JSON file as above |

### 3. Register slash commands
```bash
npm run register
```

### 4. Start the bot
```bash
npm start
```

### 5. Expose the server
```bash
ngrok http 3000
```

Set the **Interactions Endpoint URL** in the Discord Developer Portal to:
```
https://<your-ngrok-url>/interactions
```

## Firestore Data Model

```
users/
  {discord_user_id}/
    heroes: string[]
```

## Adding or Updating Heroes

Edit [`src/heroes.js`](src/heroes.js) and restart the bot. The list drives both autocomplete and validation.
