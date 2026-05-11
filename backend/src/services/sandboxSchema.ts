/**
 * Curated schema for the most-edited SandboxVars. Anything not in this list is
 * still persisted; the UI shows it under "Other".
 */

export type SandboxValueType = 'int' | 'float' | 'bool' | 'enum';

export interface SandboxSettingDef {
  /** Dotted path: "Top" or "ZombieLore.Speed" */
  path: string;
  type: SandboxValueType;
  label: string;
  description: string;
  category: SandboxCategory;
  /** Enum values: number → label. Used only for type='enum'. */
  options?: Array<{ value: number; label: string }>;
  min?: number;
  max?: number;
  /** Force display as a float even when the value is a whole number */
  isFloat?: boolean;
}

export type SandboxCategory =
  | 'Population'
  | 'World'
  | 'Time & Date'
  | 'Survival'
  | 'Loot'
  | 'Vehicles'
  | 'Combat'
  | 'XP & Character'
  | 'Zombie Lore'
  | 'Zombie Spawning';

const ABUNDANCE_6: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Insanely rare' },
  { value: 2, label: 'Extremely rare' },
  { value: 3, label: 'Rare' },
  { value: 4, label: 'Normal' },
  { value: 5, label: 'Common' },
  { value: 6, label: 'Abundant' },
];

const FREQ_7: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Never' },
  { value: 2, label: 'Extremely rare' },
  { value: 3, label: 'Rare' },
  { value: 4, label: 'Sometimes' },
  { value: 5, label: 'Often' },
  { value: 6, label: 'Very often' },
  { value: 7, label: 'Always' },
];

const SPEED_5: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Very fast' },
  { value: 2, label: 'Fast' },
  { value: 3, label: 'Normal' },
  { value: 4, label: 'Slow' },
  { value: 5, label: 'Very slow' },
];

const LEVEL_5: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Very low' },
  { value: 2, label: 'Low' },
  { value: 3, label: 'Normal' },
  { value: 4, label: 'High' },
  { value: 5, label: 'Very high' },
];

export const SANDBOX_SCHEMA: SandboxSettingDef[] = [
  // Population
  {
    path: 'Zombies',
    type: 'enum',
    label: 'Zombie population',
    description: 'Overall zombie count multiplier preset.',
    category: 'Population',
    options: [
      { value: 1, label: 'Insane' },
      { value: 2, label: 'High' },
      { value: 3, label: 'Normal' },
      { value: 4, label: 'Low' },
      { value: 5, label: 'None' },
    ],
  },
  {
    path: 'Distribution',
    type: 'enum',
    label: 'Distribution',
    description: 'Urban focused vs. uniform zombie distribution.',
    category: 'Population',
    options: [
      { value: 1, label: 'Urban focused' },
      { value: 2, label: 'Uniform' },
    ],
  },

  // Time & Date
  { path: 'DayLength', type: 'enum', label: 'Day length', description: 'Length of one in-game day.', category: 'Time & Date',
    options: [
      { value: 1, label: '15 min' }, { value: 2, label: '30 min' }, { value: 3, label: '1 hour' },
      { value: 4, label: '2 hours' }, { value: 5, label: '3 hours' }, { value: 6, label: '4 hours' },
      { value: 7, label: '5 hours' }, { value: 8, label: '6 hours' }, { value: 9, label: '7 hours' },
      { value: 10, label: '8 hours' }, { value: 11, label: '12 hours' }, { value: 12, label: '24 hours' },
    ],
  },
  { path: 'StartYear', type: 'int', label: 'Start year', description: 'Year the game starts in.', category: 'Time & Date', min: 1990, max: 2099 },
  { path: 'StartMonth', type: 'int', label: 'Start month', description: '1=January … 12=December.', category: 'Time & Date', min: 1, max: 12 },
  { path: 'StartDay', type: 'int', label: 'Start day', description: 'Day of month at world start.', category: 'Time & Date', min: 1, max: 31 },
  { path: 'StartTime', type: 'enum', label: 'Start time', description: 'Hour of day at world start.', category: 'Time & Date',
    options: [
      { value: 1, label: '7 AM' }, { value: 2, label: '9 AM' }, { value: 3, label: '12 PM' },
      { value: 4, label: '2 PM' }, { value: 5, label: '5 PM' }, { value: 6, label: '9 PM' },
    ],
  },
  { path: 'TimeSinceApo', type: 'enum', label: 'Time since apocalypse', description: 'How long since the world ended at start.', category: 'Time & Date',
    options: [
      { value: 1, label: '0 days' }, { value: 2, label: 'Several weeks' }, { value: 3, label: 'A month' },
      { value: 4, label: '2 months' }, { value: 5, label: '6 months' }, { value: 6, label: '1 year' },
      { value: 7, label: '2 years' }, { value: 8, label: '5 years' }, { value: 9, label: '10 years' },
      { value: 10, label: '20 years' },
    ],
  },

  // World
  { path: 'WaterShut', type: 'int', label: 'Water shut-off (days)', description: 'Number of in-game days before water cuts off. -1 for instant.', category: 'World', min: -1 },
  { path: 'ElecShut', type: 'int', label: 'Electricity shut-off (days)', description: 'Number of in-game days before power cuts off. -1 for instant.', category: 'World', min: -1 },
  { path: 'WaterShutModifier', type: 'int', label: 'Water shut-off variance', description: 'Random variance in days.', category: 'World', min: 0 },
  { path: 'ElecShutModifier', type: 'int', label: 'Elec shut-off variance', description: 'Random variance in days.', category: 'World', min: 0 },
  { path: 'Temperature', type: 'enum', label: 'Temperature', description: 'Overall climate setting.', category: 'World',
    options: [
      { value: 1, label: 'Very cold' }, { value: 2, label: 'Cold' }, { value: 3, label: 'Normal' },
      { value: 4, label: 'Warm' }, { value: 5, label: 'Hot' },
    ],
  },
  { path: 'Rain', type: 'enum', label: 'Rain', description: 'Rain frequency.', category: 'World', options: SPEED_5 },
  { path: 'ErosionSpeed', type: 'enum', label: 'Erosion speed', description: 'How quickly nature reclaims the world.', category: 'World', options: SPEED_5 },
  { path: 'ErosionDays', type: 'int', label: 'Erosion days override', description: 'Force a specific number of days. 0 = use ErosionSpeed.', category: 'World', min: 0 },
  { path: 'Alarm', type: 'enum', label: 'House alarms', description: 'How often house alarms trigger.', category: 'World', options: FREQ_7 },
  { path: 'LockedHouses', type: 'enum', label: 'Locked houses', description: 'How often houses are locked.', category: 'World', options: FREQ_7 },
  { path: 'Helicopter', type: 'enum', label: 'Helicopter event', description: 'Frequency of the helicopter event.', category: 'World',
    options: [{ value: 1, label: 'Never' }, { value: 2, label: 'Sometimes' }, { value: 3, label: 'Often' }],
  },
  { path: 'MetaEvent', type: 'enum', label: 'Meta events', description: 'Frequency of meta events (distant gunshots, etc.).', category: 'World',
    options: [{ value: 1, label: 'Never' }, { value: 2, label: 'Sometimes' }, { value: 3, label: 'Often' }],
  },

  // Survival
  { path: 'StarterKit', type: 'bool', label: 'Starter kit', description: 'Give players a starter kit on spawn.', category: 'Survival' },
  { path: 'Nutrition', type: 'bool', label: 'Nutrition tracking', description: 'Enable the nutrition system.', category: 'Survival' },
  { path: 'FoodRotSpeed', type: 'enum', label: 'Food rot speed', description: 'How quickly food rots outside refrigeration.', category: 'Survival', options: SPEED_5 },
  { path: 'FridgeFactor', type: 'enum', label: 'Fridge effectiveness', description: 'How well refrigeration slows food decay.', category: 'Survival', options: LEVEL_5 },
  { path: 'StatsDecrease', type: 'enum', label: 'Survival stats decrease', description: 'Speed at which hunger/thirst/etc. drop.', category: 'Survival', options: SPEED_5 },
  { path: 'NatureAbundance', type: 'enum', label: 'Nature abundance', description: 'Wild plants / foraging abundance.', category: 'Survival', options: LEVEL_5 },
  { path: 'BoneFracture', type: 'bool', label: 'Bone fractures', description: 'Allow bone fractures from impacts.', category: 'Survival' },
  { path: 'InjurySeverity', type: 'enum', label: 'Injury severity', description: 'How dangerous injuries are.', category: 'Survival',
    options: [{ value: 1, label: 'Low' }, { value: 2, label: 'Normal' }, { value: 3, label: 'High' }],
  },

  // Loot
  { path: 'FoodLoot', type: 'enum', label: 'Food loot', description: 'How rare food loot is.', category: 'Loot', options: ABUNDANCE_6 },
  { path: 'WeaponLoot', type: 'enum', label: 'Weapon loot', description: 'How rare weapons are.', category: 'Loot', options: ABUNDANCE_6 },
  { path: 'OtherLoot', type: 'enum', label: 'Other loot', description: 'Everything else.', category: 'Loot', options: ABUNDANCE_6 },
  { path: 'LootRespawn', type: 'enum', label: 'Loot respawn', description: 'How often loot respawns in unseen areas.', category: 'Loot',
    options: [
      { value: 1, label: 'None' }, { value: 2, label: 'Every day' }, { value: 3, label: 'Every week' },
      { value: 4, label: 'Every month' }, { value: 5, label: 'Every 2 months' }, { value: 6, label: 'Every 6 months' },
    ],
  },

  // Vehicles
  { path: 'EnableVehicles', type: 'bool', label: 'Vehicles enabled', description: 'Enable vehicles in the world.', category: 'Vehicles' },
  { path: 'CarSpawnRate', type: 'enum', label: 'Car spawn rate', description: 'How many cars exist in the world.', category: 'Vehicles', options: LEVEL_5 },
  { path: 'ChanceHasGas', type: 'enum', label: 'Cars have gas', description: 'Chance a spawned car has fuel in the tank.', category: 'Vehicles', options: LEVEL_5 },
  { path: 'InitialGas', type: 'enum', label: 'Initial gas', description: 'Amount of gas in cars at world start.', category: 'Vehicles', options: LEVEL_5 },
  { path: 'CarGasConsumption', type: 'float', label: 'Gas consumption', description: 'Multiplier on car fuel consumption.', category: 'Vehicles', isFloat: true },
  { path: 'CarDamageOnImpact', type: 'enum', label: 'Crash damage', description: 'How much damage cars take on impact.', category: 'Vehicles', options: LEVEL_5 },

  // Combat
  { path: 'MultiHitZombies', type: 'bool', label: 'Multi-hit zombies', description: 'A single weapon swing can hit several zombies.', category: 'Combat' },
  { path: 'AllClothesUnlocked', type: 'bool', label: 'All clothes unlocked', description: 'Skip the clothing-research progression.', category: 'Combat' },
  { path: 'AttackBlockMovements', type: 'bool', label: 'Attacks block movement', description: 'Player movement is interrupted while swinging.', category: 'Combat' },
  { path: 'BloodLevel', type: 'enum', label: 'Blood level', description: 'How much blood remains on clothes and surfaces.', category: 'Combat', options: LEVEL_5 },
  { path: 'ClothingDegradation', type: 'enum', label: 'Clothing degradation', description: 'Speed at which clothing wears down.', category: 'Combat', options: SPEED_5 },

  // XP & Character
  { path: 'XpMultiplier', type: 'float', label: 'XP multiplier', description: 'Multiplier on all XP gains.', category: 'XP & Character', isFloat: true },
  { path: 'XpMultiplierAffectsLevel1', type: 'bool', label: 'XP multiplier on level 1', description: 'Apply the XP multiplier when leveling from 0.', category: 'XP & Character' },
  { path: 'CharacterFreePoints', type: 'int', label: 'Free character points', description: 'Extra trait points at character creation.', category: 'XP & Character', min: 0 },
  { path: 'ConstructionBonusPoints', type: 'enum', label: 'Construction bonus', description: 'Bonus to construction skill XP.', category: 'XP & Character', options: LEVEL_5 },

  // Zombie Lore (nested)
  { path: 'ZombieLore.Speed', type: 'enum', label: 'Speed', description: 'Sprinter / fast shambler / shambler.', category: 'Zombie Lore',
    options: [{ value: 1, label: 'Sprinters' }, { value: 2, label: 'Fast shamblers' }, { value: 3, label: 'Shamblers' }] },
  { path: 'ZombieLore.Strength', type: 'enum', label: 'Strength', description: 'Zombie physical strength.', category: 'Zombie Lore',
    options: [{ value: 1, label: 'Superhuman' }, { value: 2, label: 'Normal' }, { value: 3, label: 'Weak' }] },
  { path: 'ZombieLore.Toughness', type: 'enum', label: 'Toughness', description: 'How resilient zombies are to damage.', category: 'Zombie Lore',
    options: [{ value: 1, label: 'Tough' }, { value: 2, label: 'Normal' }, { value: 3, label: 'Fragile' }] },
  { path: 'ZombieLore.Transmission', type: 'enum', label: 'Transmission', description: 'How the virus spreads.', category: 'Zombie Lore',
    options: [{ value: 1, label: 'Blood + saliva' }, { value: 2, label: 'Saliva only' }, { value: 3, label: 'Everyone infected' }, { value: 4, label: 'None' }] },
  { path: 'ZombieLore.Mortality', type: 'enum', label: 'Mortality after infection', description: 'How quickly bitten characters die.', category: 'Zombie Lore',
    options: [{ value: 1, label: '0-30 seconds' }, { value: 2, label: '0-1 minute' }, { value: 3, label: '0-12 hours' }, { value: 4, label: '2-3 days' }, { value: 5, label: '1-2 weeks' }, { value: 6, label: 'Never' }] },
  { path: 'ZombieLore.Reanimate', type: 'enum', label: 'Reanimate', description: 'Time after death until reanimation.', category: 'Zombie Lore',
    options: [{ value: 1, label: 'Instant' }, { value: 2, label: '0-1 minute' }, { value: 3, label: '0-12 hours' }, { value: 4, label: '2-3 days' }, { value: 5, label: '1-2 weeks' }, { value: 6, label: 'Never' }] },
  { path: 'ZombieLore.Cognition', type: 'enum', label: 'Cognition', description: 'How smart zombies are.', category: 'Zombie Lore',
    options: [{ value: 1, label: 'Can open doors' }, { value: 2, label: 'Basic navigation' }, { value: 3, label: 'Basic' }] },
  { path: 'ZombieLore.Memory', type: 'enum', label: 'Memory', description: 'How long zombies remember player.', category: 'Zombie Lore',
    options: [{ value: 1, label: 'Long' }, { value: 2, label: 'Normal' }, { value: 3, label: 'Short' }, { value: 4, label: 'None' }] },
  { path: 'ZombieLore.Sight', type: 'enum', label: 'Sight', description: 'How well zombies see.', category: 'Zombie Lore',
    options: [{ value: 1, label: 'Eagle' }, { value: 2, label: 'Normal' }, { value: 3, label: 'Poor' }] },
  { path: 'ZombieLore.Hearing', type: 'enum', label: 'Hearing', description: 'How well zombies hear.', category: 'Zombie Lore',
    options: [{ value: 1, label: 'Pinpoint' }, { value: 2, label: 'Normal' }, { value: 3, label: 'Poor' }] },
  { path: 'ZombieLore.ZombiesDragDown', type: 'bool', label: 'Zombies drag down', description: 'Zombies can grab and pull players down.', category: 'Zombie Lore' },
  { path: 'ZombieLore.ZombiesFenceLunge', type: 'bool', label: 'Zombies fence lunge', description: 'Zombies can lunge over fences.', category: 'Zombie Lore' },

  // Zombie Spawning
  { path: 'ZombieConfig.PopulationMultiplier', type: 'float', label: 'Population multiplier', description: 'Global zombie count multiplier.', category: 'Zombie Spawning', isFloat: true },
  { path: 'ZombieConfig.PopulationStartMultiplier', type: 'float', label: 'Population start multiplier', description: 'Population at world start.', category: 'Zombie Spawning', isFloat: true },
  { path: 'ZombieConfig.PopulationPeakMultiplier', type: 'float', label: 'Population peak multiplier', description: 'Maximum population reached.', category: 'Zombie Spawning', isFloat: true },
  { path: 'ZombieConfig.PopulationPeakDay', type: 'int', label: 'Population peak day', description: 'Day at which the peak population is reached.', category: 'Zombie Spawning', min: 0 },
  { path: 'ZombieConfig.RespawnHours', type: 'float', label: 'Respawn hours', description: 'Hours before zombies respawn in cleared cells.', category: 'Zombie Spawning', isFloat: true },
  { path: 'ZombieConfig.RespawnUnseenHours', type: 'float', label: 'Respawn unseen hours', description: 'Cells must be unseen this long before respawn.', category: 'Zombie Spawning', isFloat: true },
  { path: 'ZombieConfig.RespawnMultiplier', type: 'float', label: 'Respawn multiplier', description: 'Fraction of original population that respawns.', category: 'Zombie Spawning', isFloat: true },
  { path: 'ZombieConfig.RedistributeHours', type: 'float', label: 'Redistribute hours', description: 'Hours between redistribution passes.', category: 'Zombie Spawning', isFloat: true },
  { path: 'ZombieConfig.FollowSoundDistance', type: 'int', label: 'Follow sound distance', description: 'How far zombies follow sounds (tiles).', category: 'Zombie Spawning', min: 0 },
  { path: 'ZombieConfig.RallyGroupSize', type: 'int', label: 'Rally group size', description: 'Average size of a roaming horde.', category: 'Zombie Spawning', min: 0 },
];

export const SANDBOX_CATEGORIES: SandboxCategory[] = [
  'Population',
  'Time & Date',
  'World',
  'Survival',
  'Loot',
  'Vehicles',
  'Combat',
  'XP & Character',
  'Zombie Lore',
  'Zombie Spawning',
];
