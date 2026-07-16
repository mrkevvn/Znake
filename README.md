<h1 align="center">Znake</h1>

<p align="center">
  <strong>A full-featured Discord management bot built with Discord.js v14</strong>
</p>

<p align="center">
  <a href="#features">Features</a> · <a href="#installation">Installation</a> · <a href="#configuration">Configuration</a> · <a href="#commands">Commands</a> · <a href="#tech-stack">Tech Stack</a>
</p>

---

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D16.9.0-339933?logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white" alt="Discord.js">
  <img src="https://img.shields.io/badge/license-ISC-blue" alt="License">
  <img src="https://img.shields.io/badge/commands-87+-purple" alt="Commands">
</p>

---

**Znake** is a comprehensive Discord management bot designed for server administration, moderation, and community engagement. It features a complete ticket system, advanced moderation tools, XP/leveling, giveaways, polls, auto-moderation, and more — all powered by slash commands with a JSON flat-file database requiring zero external setup.

## Features

<details open>
<summary><strong>Support &amp; Ticket System</strong></summary>

- Category-based ticket creation with priority levels (Low, Medium, High, Critical)
- Private ticket channels with granular permission control
- Claim / Close / Transcript workflow
- Inactivity auto-close with configurable timeouts
- Bulk close operations with confirmation
- Professional support panel with dropdown category selection
- Duplicate ticket prevention and anti-spam cooldowns

</details>

<details>
<summary><strong>Moderation &amp; Administration</strong></summary>

- Ban, kick, softban, massban, timeout, and warn commands
- Role management: add, remove, strip, restore, and auto-role
- Channel lock / unlock / lockdown with timed support
- Blacklist system for permanent user/guild bans
- Staff case tracking with linked timelines
- Private staff notes on users
- Watchlist monitoring
- Slowmode control

</details>

<details>
<summary><strong>Security &amp; Auto-Moderation</strong></summary>

- Anti-spam: detects and times out rapid message flooding
- Anti-invite: automatically removes Discord invite links
- Anti-link: blocks all URLs in messages
- Configurable per-guild with instant toggle

</details>

<details>
<summary><strong>Community &amp; Engagement</strong></summary>

- XP and leveling system with rank cards and leaderboards
- Interactive polls with up to 10 options and auto-tallying
- Button-based giveaways with eligibility rules and cryptographic winner selection
- Suggestion system with voting, approval workflow, and board display
- Welcome and goodbye messages with DM support
- Auto-role assignment for new members

</details>

<details>
<summary><strong>Utility &amp; Tools</strong></summary>

- Custom embed builder with create, edit, send, and DM delivery
- Server and channel info commands
- User lookup by ID or mention
- Interactive calculator
- Server backup and restore system
- Transcript export (TXT/JSON)
- Command hot-reload without restart

</details>

<details>
<summary><strong>Logging &amp; Monitoring</strong></summary>

- Configurable per-guild log channels for different event types
- Audit log formatting for moderation actions
- Developer command usage logs
- File-based logging with daily rotation

</details>

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) 16.9.0 or higher
- A Discord bot token from the [Discord Developer Portal](https://discord.com/developers/applications)

### Setup

```bash
# Clone the repository
git clone https://github.com/mrkevvn/Znake.git
cd Znake

# Install dependencies
npm install

# Configure the bot (see Configuration section)
# Create config.json manually — see example below
```

### Running

```bash
# Start the bot
npm start

# Register slash commands globally
npm run deploy
```

## Configuration

Create a `config.json` file in the project root:

```json
{
  "token": "YOUR_BOT_TOKEN",
  "clientId": "YOUR_CLIENT_ID",
  "owners": ["YOUR_USER_ID"],
  "embedColor": "#5865F2",
  "errorColor": "#ED4245",
  "successColor": "#57F287",
  "warningColor": "#FEE75C",
  "cooldownDefault": 3,
  "inviteLink": "https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID",
  "supportServer": "https://discord.gg/YOUR_SERVER",
  "website": "",
  "version": "1.0.0"
}
```

| Key | Description |
|-----|-------------|
| `token` | Bot token (can be overridden with `BOT_TOKEN` env var) |
| `clientId` | Application client ID (can be overridden with `CLIENT_ID` env var) |
| `owners` | Array of Discord user IDs with owner-level access |
| `embedColor` | Default embed color |
| `cooldownDefault` | Default command cooldown in seconds |
| `inviteLink` | Bot OAuth2 invite URL |
| `supportServer` | Support server invite URL |

> **Note:** The `config.json` file is gitignored. All guild-specific settings are stored in the `data/` directory as JSON files and are created automatically on first run.

## Commands

Znake includes **87 slash commands** and **1 context menu command** organized into 17 categories.

<details open>
<summary><strong>Moderation</strong> (27 commands)</summary>

| Command | Description | Permission |
|---------|-------------|------------|
| `/ban` | Ban a member from the server | Ban Members |
| `/kick` | Kick a member from the server | Kick Members |
| `/softban` | Ban then unban to purge messages | Ban Members |
| `/massban` | Ban multiple users by ID | Ban Members |
| `/unban` | Unban a user by ID or Case ID | Ban Members |
| `/timeout` | Timeout (mute) a member | Moderate Members |
| `/untimeout` | Remove a timeout from a member | Moderate Members |
| `/warn` | Issue a warning to a member | Moderate Members |
| `/warnings` | View all warnings for a member | Moderate Members |
| `/removewarn` | Remove a warning by ID | Moderate Members |
| `/history` | View moderation history of a user | Moderate Members |
| `/lock` | Lock a channel (prevent @everyone messages) | Manage Roles |
| `/unlock` | Unlock a channel | Manage Roles |
| `/lockdown` | Lock all server channels | Manage Roles |
| `/unlockdown` | Unlock all channels after lockdown | Manage Roles |
| `/timedlockdown` | Lock a channel for a duration | Manage Roles |
| `/slowmode` | Set or disable slowmode | Manage Channels |
| `/clear` | Bulk delete messages | Manage Messages |
| `/stripperms` | Remove all roles from a user | Manage Roles |
| `/restoreroles` | Restore stripped roles | Manage Roles |
| `/note` | Manage private staff notes | Moderate Members |
| `/watchlist` | Manage the staff watchlist | Moderate Members |
| `/managexp` | Manage XP for a member | Manage Guild |
| `/mutualservers` | Show shared servers with the bot | Moderate Members |
| `/blacklist` | Block a user from all bot commands | Administrator |
| `/blacklistcheck` | Check blacklist status | Administrator |
| `/blacklistremove` | Remove from blacklist | Administrator |
| `/blacklistview` | View all blacklisted users | Administrator |
| `/appeal` | Appeal a punishment | View Channel |

</details>

<details>
<summary><strong>Ticket System</strong></summary>

| Command | Description | Permission |
|---------|-------------|------------|
| `/ticket setticketchannel` | Set the ticket panel channel | Administrator |
| `/ticket config` | Configure ticket settings | Administrator |
| `/ticket panel` | Deploy the ticket panel | Administrator |
| `/ticket close` | Close a ticket | Staff |
| `/ticket claim` | Claim a ticket | Staff |
| `/ticket transcript` | Generate ticket transcript | Staff |
| `/ticket adduser` | Add a user to a ticket | Staff |
| `/ticket removeuser` | Remove a user from a ticket | Staff |
| `/ticket priority` | Set ticket priority | Staff |
| `/ticket status` | Update ticket status | Staff |
| `/ticket history` | View ticket history | Staff |
| `/ticket bulkclose` | Close multiple tickets | Staff |

</details>

<details>
<summary><strong>Staff Management</strong> (8 commands)</summary>

| Command | Description | Permission |
|---------|-------------|------------|
| `/setstaffrole` | Add a staff role | Administrator |
| `/removestaffrole` | Remove a staff role | Administrator |
| `/liststaffroles` | View all staff roles | Manage Roles |
| `/announcement` | Send announcement embed | Staff |
| `/staffnotice` | Send staff notice embed | Staff |
| `/case` | Look up staff cases | Staff |
| `/embeddm` | Send embed DM to a user | Administrator |
| `/warnuser` | Warn a user by ID with DM | Moderate Members |

</details>

<details>
<summary><strong>General</strong> (7 commands)</summary>

| Command | Description | Permission |
|---------|-------------|------------|
| `/help` | Browse all commands interactively | Everyone |
| `/about` | Learn about the bot | Everyone |
| `/uptime` | View live uptime and status | Everyone |
| `/rank` | Check your level and XP | Everyone |
| `/leaderboard` | View server XP leaderboard | Everyone |
| `/cal` | Open interactive calculator | Everyone |
| `/support` | Get help and contact support | Everyone |

</details>

<details>
<summary><strong>Server Info</strong> (5 commands)</summary>

| Command | Description | Permission |
|---------|-------------|------------|
| `/serverinfo` | View server details | Everyone |
| `/serverstats` | View server statistics | Everyone |
| `/channelinfo` | View channel details | Everyone |
| `/roleinfo` | View role details | Everyone |
| `/emojiinfo` | View emoji details | Everyone |

</details>

<details>
<summary><strong>User Info</strong> (6 commands)</summary>

| Command | Description | Permission |
|---------|-------------|------------|
| `/userinfo` | View user information | Everyone |
| `/userinfoid` | Look up user by ID | Everyone |
| `/avatar` | View user avatar | Everyone |
| `/banner` | View user banner | Everyone |
| `/roles` | View member roles | Everyone |
| `/membercount` | View member count | Everyone |

</details>

<details>
<summary><strong>Embeds &amp; Messaging</strong> (3 commands)</summary>

| Command | Description | Permission |
|---------|-------------|------------|
| `/embed` | Create, edit, send, and manage embeds | Administrator |
| `/say` | Make the bot send a message | Administrator |
| `Say` (Context Menu) | Reply as bot via modal | Administrator |

</details>

<details>
<summary><strong>Suggestions</strong> (6 commands)</summary>

| Command | Description | Permission |
|---------|-------------|------------|
| `/suggest` | Submit a suggestion | Everyone |
| `/suggestions` | Manage suggestions with buttons | Staff |
| `/approve` | Approve a suggestion | Staff |
| `/deny` | Deny a suggestion | Staff |
| `/suggestboard` | View suggestion leaderboard | Staff |
| `/suggestionselector` | Set suggestion channel | Staff |

</details>

<details>
<summary><strong>Security</strong> (3 commands)</summary>

| Command | Description | Permission |
|---------|-------------|------------|
| `/antispam` | Toggle anti-spam system | Administrator |
| `/antiinvite` | Toggle anti-invite system | Administrator |
| `/antilink` | Toggle anti-link system | Administrator |

</details>

<details>
<summary><strong>Remaining Categories</strong></summary>

**Giveaway**
| Command | Description | Permission |
|---------|-------------|------------|
| `/giveaway` | Create a giveaway | Manage Messages |

**Poll**
| Command | Description | Permission |
|---------|-------------|------------|
| `/poll` | Create interactive poll | Manage Messages |

**Roles**
| Command | Description | Permission |
|---------|-------------|------------|
| `/role` | Manage roles | Manage Roles |
| `/autorole` | Configure auto-role | Manage Roles |

**Welcome**
| Command | Description | Permission |
|---------|-------------|------------|
| `/setwelcome` | Configure welcome message | Manage Guild |
| `/setgoodbye` | Configure goodbye message | Manage Guild |
| `/welcome` | Manage welcome system | Manage Guild |

**Logging**
| Command | Description | Permission |
|---------|-------------|------------|
| `/setlogchannel` | Set a log channel | Administrator |
| `/logsettings` | Configure log settings | Administrator |
| `/viewlogs` | View configured log channels | Manage Guild |

**Config**
| Command | Description | Permission |
|---------|-------------|------------|
| `/config` | Manage bot configuration | Administrator |
| `/setlevelup` | Configure level-up settings | Manage Guild |

**Backup**
| Command | Description | Permission |
|---------|-------------|------------|
| `/backup` | Manage server backups | Administrator |

**Developer** *(Owner-only)*
| Command | Description |
|---------|-------------|
| `/reload` | Hot-reload commands and events |
| `/restart` | Restart the bot process |
| `/shutdown` | Shut down the bot |
| `/maintenance` | Toggle maintenance mode |
| `/devlogs` | View developer command logs |
| `/whitelist` | Manage developer whitelist |
| `/transcript` | Export channel transcript |

</details>

## Tech Stack

| Technology | Purpose |
|------------|---------|
| [Node.js](https://nodejs.org/) | Runtime environment |
| [Discord.js v14](https://discord.js.org/) | Discord API wrapper |
| [@discordjs/builders](https://discord.js.org/) | Slash command construction |
| [@discordjs/rest](https://discord.js.org/) | REST API for command registration |
| [math.js](https://mathjs.org/) | Interactive calculator |
| [moment.js](https://momentjs.com/) | Date and time formatting |
| [chalk](https://github.com/chalk/chalk) | Colored console output |

**Storage:** JSON flat-file database — no external database required. All guild data persists in the `data/` directory.

## Project Structure

```
Znake/
├── index.js                 # Entry point — client setup, handlers, intervals
├── deployCommands.js        # Global slash command registration script
├── package.json
├── config.json              # Bot configuration (gitignored)
│
├── commands/                # All slash commands organized by category
│   ├── backup/
│   ├── config/
│   ├── dev/
│   ├── embed/
│   ├── general/
│   ├── giveaway/
│   ├── logging/
│   ├── moderation/          # 27 moderation commands
│   ├── poll/
│   ├── role/
│   ├── security/
│   ├── server/
│   ├── staff/
│   ├── suggestions/
│   ├── ticket/
│   ├── user/
│   └── welcome/
│
├── events/                  # Discord event listeners
│   ├── ready.js
│   ├── interactionCreate.js
│   ├── messageCreate.js
│   ├── guildMemberAdd.js
│   ├── guildMemberRemove.js
│   └── ...
│
├── handlers/                # Core system handlers
│   ├── commandHandler.js
│   ├── eventHandler.js
│   ├── antiSpamHandler.js
│   ├── helpComponents.js
│   ├── ticketComponents.js
│   └── ticketInactivity.js
│
├── dev/                     # Test scripts and audit tools

├── utils/                   # Shared utilities and services
│   ├── database.js          # JSON flat-file database engine
│   ├── permissions.js       # Permission and staff checks
│   ├── embeds.js            # Embed template builders
│   ├── xp.js                # XP/leveling system
│   ├── ticketManager.js     # Ticket lifecycle management
│   ├── giveawayManager.js   # Giveaway system
│   ├── logger.js            # File and console logging
│   └── ...
│
├── data/                    # Persistent JSON databases (auto-created)
│   ├── tickets.json
│   ├── warnings.json
│   ├── levels.json
│   ├── giveaways.json
│   └── ...
│
└── logs/                    # Daily log files
```

## How It Works

### Permission Model

Znake uses a layered permission system:

1. **Discord UI gating** — `setDefaultMemberPermissions()` hides commands from users who lack the required Discord permission
2. **Staff role system** — Configurable per-guild staff roles stored in `data/staff_roles.json`; staff members can execute moderation commands
3. **Owner gating** — Bot owners defined in `config.owners` have access to developer commands
4. **Administrator bypass** — Administrators are always treated as staff

### Data Storage

All data is stored as JSON files in the `data/` directory. The database module (`utils/database.js`) provides `read()`, `write()`, `getGuild()`, and `setGuild()` methods with automatic schema initialization. No external database setup is required.

### Status Rotation

The bot rotates its presence status every 12 seconds between:

- `/help | Znake`
- `Serving N servers`
- `Managing tickets & tools`
- `Powered by Znake`

## Roadmap

- [ ] Web dashboard for server configuration
- [ ] Database migration to SQLite or PostgreSQL
- [ ] Localization support (i18n)
- [ ] Custom command builder
- [ ] Reaction roles
- [ ] Auto-moderation rule customization
- [ ] Ticket analytics and reporting

## Contributing

Contributions are welcome. Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please ensure your code follows the existing style and does not introduce linting errors.

## License

This project is licensed under the ISC License.

## Credits

- Built with [Discord.js](https://discord.js.org/)
- Package manager: [npm](https://www.npmjs.com/)
