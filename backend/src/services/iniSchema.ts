/**
 * Curated schema for the most-edited entries of servertest.ini. Anything not in
 * this list still gets persisted via the "raw" pass; the UI just exposes it as
 * a plain text input under an "Other" category.
 */

export type IniValueType = 'bool' | 'int' | 'float' | 'string' | 'enum';

export interface IniSettingDef {
  key: string;
  type: IniValueType;
  label: string;
  description: string;
  category: IniCategory;
  default?: string;
  /** For type='enum' */
  options?: string[];
  /** For numeric ranges (advisory; not strictly enforced server-side) */
  min?: number;
  max?: number;
}

export type IniCategory =
  | 'Identity'
  | 'Network'
  | 'Players'
  | 'PvP & Safety'
  | 'Gameplay'
  | 'World'
  | 'Loot'
  | 'Backups & Saves'
  | 'Chat'
  | 'RCON'
  | 'Steam'
  | 'Discord'
  | 'Mods';

export const INI_SCHEMA: IniSettingDef[] = [
  // Identity
  { key: 'PublicName', type: 'string', label: 'Public name', description: 'Name shown in the server browser.', category: 'Identity', default: 'My PZ Server' },
  { key: 'PublicDescription', type: 'string', label: 'Description', description: 'Free-form description shown in the server browser.', category: 'Identity' },
  { key: 'Public', type: 'bool', label: 'Listed publicly', description: 'List this server in the public browser.', category: 'Identity', default: 'false' },
  { key: 'ServerWelcomeMessage', type: 'string', label: 'Welcome message', description: 'Greeting shown to players when they join.', category: 'Identity' },

  // Network
  { key: 'DefaultPort', type: 'int', label: 'Game port (UDP)', description: 'Main game port.', category: 'Network', default: '16261' },
  { key: 'UDPPort', type: 'int', label: 'UDP port', description: 'Raknet UDP port. Default 16262.', category: 'Network', default: '16262' },
  { key: 'Password', type: 'string', label: 'Server password', description: 'Players must enter this to join. Leave blank for none.', category: 'Network' },
  { key: 'Open', type: 'bool', label: 'Open server', description: 'Allow new players to join (turn off for a closed beta).', category: 'Network', default: 'true' },

  // Players
  { key: 'MaxPlayers', type: 'int', label: 'Max players', description: 'Maximum concurrent connections.', category: 'Players', default: '16', min: 1, max: 100 },
  { key: 'PauseEmpty', type: 'bool', label: 'Pause when empty', description: 'Freeze the in-game clock when no players are online.', category: 'Players', default: 'true' },
  { key: 'AutoCreateUserInWhiteList', type: 'bool', label: 'Auto-create whitelist users', description: 'When enabled, players are auto-added to the whitelist on first connect.', category: 'Players', default: 'false' },
  { key: 'MaxAccountsPerUser', type: 'int', label: 'Max accounts per user', description: 'Limit on accounts allowed per Steam ID. 0 = unlimited.', category: 'Players', default: '0' },
  { key: 'AllowCoop', type: 'bool', label: 'Allow split-screen coop', description: 'Let players use the local coop feature on this server.', category: 'Players', default: 'true' },
  { key: 'AllowNonAsciiUsername', type: 'bool', label: 'Allow non-ASCII usernames', description: 'Accept unicode characters in player names.', category: 'Players', default: 'false' },
  { key: 'KickFastPlayers', type: 'bool', label: 'Kick fast players', description: 'Kick players whose client appears to be running too fast.', category: 'Players', default: 'false' },

  // PvP & Safety
  { key: 'PVP', type: 'bool', label: 'PvP enabled', description: 'Allow player vs. player damage.', category: 'PvP & Safety', default: 'true' },
  { key: 'SafetySystem', type: 'bool', label: 'Safety system', description: 'Players can toggle PvP damage individually.', category: 'PvP & Safety', default: 'true' },
  { key: 'ShowSafety', type: 'bool', label: 'Show safety state', description: 'Show a safety indicator above other players.', category: 'PvP & Safety', default: 'true' },
  { key: 'SafetyToggleTimer', type: 'int', label: 'Safety toggle timer (s)', description: 'Cooldown after toggling safety before the new state applies.', category: 'PvP & Safety', default: '2' },
  { key: 'SafetyCooldownTimer', type: 'int', label: 'Safety cooldown (s)', description: 'Cooldown between consecutive safety toggles.', category: 'PvP & Safety', default: '3' },
  { key: 'DisplayUserName', type: 'bool', label: 'Display usernames', description: 'Show floating names above characters.', category: 'PvP & Safety', default: 'true' },

  // Gameplay
  { key: 'SpawnItems', type: 'string', label: 'Spawn items', description: 'Comma-separated module.item entries given to new characters.', category: 'Gameplay' },
  { key: 'SpawnPoint', type: 'string', label: 'Spawn point', description: 'Forced spawn coordinates (x,y,z). Leave empty for normal spawn screen.', category: 'Gameplay' },
  { key: 'NoFire', type: 'bool', label: 'Disable fire', description: 'Prevent any fire propagation on the server.', category: 'Gameplay', default: 'false' },
  { key: 'NoFireSpread', type: 'bool', label: 'No fire spread', description: 'Fires burn in place but do not spread.', category: 'Gameplay', default: 'false' },
  { key: 'AnnounceDeath', type: 'bool', label: 'Announce deaths', description: 'Post a global message when a player dies.', category: 'Gameplay', default: 'false' },
  { key: 'DisableSafehouseWhenPlayerConnected', type: 'bool', label: 'Disable safehouse if owner online', description: 'Disable safehouse protection while the owner is connected.', category: 'Gameplay', default: 'false' },

  // World
  { key: 'Map', type: 'string', label: 'Map', description: 'Map IDs separated by semicolons. Default: "Muldraugh, KY".', category: 'World', default: 'Muldraugh, KY' },
  { key: 'SaveWorldEveryMinutes', type: 'int', label: 'Autosave (minutes)', description: 'Interval between background world saves. 0 = disabled.', category: 'World', default: '0' },
  { key: 'PingLimit', type: 'int', label: 'Ping limit (ms)', description: 'Players above this ping get kicked. 0 = no limit.', category: 'World', default: '400' },
  { key: 'KickFastPlayers', type: 'bool', label: 'Kick fast players (dup)', description: 'Duplicate of the Players setting; PZ ships it in this section too.', category: 'World' },

  // Loot
  { key: 'HoursForLootRespawn', type: 'int', label: 'Hours for loot respawn', description: 'Game-time hours before loot respawns in unexplored containers. 0 = disabled.', category: 'Loot', default: '0' },
  { key: 'MaxItemsForLootRespawn', type: 'int', label: 'Max items for loot respawn', description: 'Containers with more items than this skip respawn.', category: 'Loot', default: '4' },
  { key: 'ConstructionPreventsLootRespawn', type: 'bool', label: 'Construction prevents respawn', description: 'Player-built structures stop loot respawn in their cell.', category: 'Loot', default: 'true' },

  // Backups
  { key: 'BackupsCount', type: 'int', label: 'Backups to keep', description: 'Maximum number of automatic backups to retain.', category: 'Backups & Saves', default: '5' },
  { key: 'BackupsOnStart', type: 'bool', label: 'Backup on server start', description: 'Create a backup each time the server starts.', category: 'Backups & Saves', default: 'true' },
  { key: 'BackupsOnVersionChange', type: 'bool', label: 'Backup on version change', description: 'Create a backup when the PZ version changes.', category: 'Backups & Saves', default: 'true' },
  { key: 'BackupsPeriod', type: 'int', label: 'Backup period (minutes)', description: 'Periodic backup interval. 0 = disabled.', category: 'Backups & Saves', default: '0' },

  // Chat
  { key: 'GlobalChat', type: 'bool', label: 'Global chat', description: 'Allow the global chat channel.', category: 'Chat', default: 'true' },
  { key: 'ChatStreams', type: 'string', label: 'Chat streams', description: 'Comma-separated list of enabled chat streams.', category: 'Chat', default: 's,r,a,w,y,sh,f,all' },

  // RCON
  { key: 'RCONPort', type: 'int', label: 'RCON port', description: 'TCP port for RCON. PZ has no native RCON for admin commands; this is mostly used by some monitoring tools.', category: 'RCON', default: '27015' },
  { key: 'RCONPassword', type: 'string', label: 'RCON password', description: 'Required if RCON is enabled.', category: 'RCON' },

  // Steam
  { key: 'SteamPort1', type: 'int', label: 'Steam port 1', description: 'Steam query port 1.', category: 'Steam', default: '8766' },
  { key: 'SteamPort2', type: 'int', label: 'Steam port 2', description: 'Steam query port 2.', category: 'Steam', default: '8767' },
  { key: 'SteamScoreboard', type: 'bool', label: 'Steam scoreboard', description: 'Push deaths and stats to the Steam scoreboard.', category: 'Steam', default: 'true' },
  { key: 'WorkshopItems', type: 'string', label: 'Workshop IDs', description: 'Semicolon-separated list of Steam Workshop IDs subscribed by the server.', category: 'Steam' },
  { key: 'Mods', type: 'string', label: 'Mod folders', description: 'Semicolon-separated list of mod folder names to load.', category: 'Steam' },

  // Discord
  { key: 'DiscordEnable', type: 'bool', label: 'Discord bot enabled', description: 'Bridges global chat to a Discord channel.', category: 'Discord', default: 'false' },
  { key: 'DiscordToken', type: 'string', label: 'Discord token', description: 'Bot token. Treat as a secret.', category: 'Discord' },
  { key: 'DiscordChannel', type: 'string', label: 'Discord channel', description: 'Channel name to relay messages to.', category: 'Discord' },
  { key: 'DiscordChannelID', type: 'string', label: 'Discord channel ID', description: 'Channel ID (snowflake) — preferred over the name.', category: 'Discord' },
];

// Some keys appear in two categories above (e.g. KickFastPlayers). Deduplicate so the
// UI never gets confused, keeping the first occurrence.
const seenKeys = new Set<string>();
export const INI_SCHEMA_DEDUPED: IniSettingDef[] = INI_SCHEMA.filter((s) => {
  if (seenKeys.has(s.key)) return false;
  seenKeys.add(s.key);
  return true;
});

export const INI_CATEGORIES: IniCategory[] = [
  'Identity',
  'Network',
  'Players',
  'PvP & Safety',
  'Gameplay',
  'World',
  'Loot',
  'Backups & Saves',
  'Chat',
  'RCON',
  'Steam',
  'Discord',
  'Mods',
];
